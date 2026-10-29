import { BeamAdapter, BeamAdapterOptions } from './beam.adapter';
import { DecoderAdapter, DetectionCallback } from './decoder-adapter';
import { OpenStintAdapter, OpenStintAdapterOptions } from './openstint.adapter';

export interface BeamOpenStintAdapterOptions {
  beam: BeamAdapterOptions;
  openstint: OpenStintAdapterOptions;
  windowMs: number;
  forwardBeamOnly: boolean;
}

/** How late an OpenStint passing may arrive after its own timestamp: ~250ms
 *  after the car leaves the loop, plus a slow car's time over it. */
const READ_LAG_MS = 1000;

interface Item {
  t: number;
  emitted: boolean;
}
interface Read extends Item {
  id: string;
}

export interface Emission {
  transponderId: string | undefined;
  timestampMs: number;
  metadata: Record<string, unknown>;
}

/**
 * A pair is a beam with exactly one read in its window whose window holds
 * only that beam — anything looser is a guess, and a wrong guess hands one car
 * another's time. What happens to the unpaired: docs/decoder-adapters.md.
 * An item settles once everything that could pair with it, or with its
 * partner, has arrived.
 */
export class PassingMatcher {
  private beams: Item[] = [];
  private reads: Read[] = [];

  constructor(private readonly windowMs: number) {}

  addBeam(t: number): void {
    this.beams.push({ t, emitted: false });
  }

  addRead(id: string, t: number): void {
    this.reads.push({ id, t, emitted: false });
  }

  flush(nowMs: number): Emission[] {
    const settleMs = 2 * this.windowMs + READ_LAG_MS;
    const out: Emission[] = [];
    for (const beam of this.beams) {
      if (beam.emitted || beam.t + settleMs > nowMs) continue;
      beam.emitted = true;
      const near = this.near(this.reads, beam.t);
      const read = this.partner(beam);
      out.push(
        read
          ? {
              transponderId: read.id,
              timestampMs: beam.t,
              metadata: { readOffsetMs: Math.round(read.t - beam.t) },
            }
          : {
              transponderId: undefined,
              timestampMs: beam.t,
              metadata: near.length
                ? { candidates: near.map((r) => r.id) }
                : {},
            },
      );
    }
    for (const read of this.reads) {
      if (read.emitted || read.t + settleMs > nowMs) continue;
      read.emitted = true;
      const near = this.near(this.beams, read.t);
      if (near.length === 1 && this.partner(near[0]) === read) continue;
      out.push({
        transponderId: read.id,
        timestampMs: read.t,
        metadata: { beam: near.length ? 'ambiguous' : 'missed' },
      });
    }
    // Emitted items still matter to their neighbours' rules until those settle.
    const keepFrom = nowMs - 2 * settleMs;
    this.beams = this.beams.filter((b) => !b.emitted || b.t >= keepFrom);
    this.reads = this.reads.filter((r) => !r.emitted || r.t >= keepFrom);
    return out.sort((a, b) => a.timestampMs - b.timestampMs);
  }

  private partner(beam: Item): Read | undefined {
    const reads = this.near(this.reads, beam.t);
    return reads.length === 1 && this.near(this.beams, reads[0].t).length === 1
      ? reads[0]
      : undefined;
  }

  private near<T extends Item>(items: T[], t: number): T[] {
    return items.filter((i) => Math.abs(i.t - t) <= this.windowMs);
  }
}

/**
 * A read without its beam has only a radio time, so it never times. A beam
 * with reads near is a car for the marshal; one with none may be a phantom,
 * and goes out only for a field where some cars carry no transponder.
 */
export function forwarded(e: Emission, forwardBeamOnly: boolean): boolean {
  if (e.transponderId) return !e.metadata.beam;
  return forwardBeamOnly || 'candidates' in e.metadata;
}

/** Either decoder failing exits gate-agent, as it does alone. */
export class BeamOpenStintAdapter implements DecoderAdapter {
  private readonly beam: BeamAdapter;
  private readonly openstint: OpenStintAdapter;
  private readonly matcher: PassingMatcher;
  private timer?: NodeJS.Timeout;
  private onDetection?: DetectionCallback;

  constructor(private readonly options: BeamOpenStintAdapterOptions) {
    this.beam = new BeamAdapter(options.beam);
    this.openstint = new OpenStintAdapter(options.openstint);
    this.matcher = new PassingMatcher(options.windowMs);
  }

  /** The beam times a passing, so only the beam beeps. */
  start(onDetection: DetectionCallback, onSense?: () => void): void {
    this.onDetection = onDetection;
    this.beam.start(
      (_, timestamp) => this.matcher.addBeam(timestamp.getTime()),
      onSense,
    );
    this.openstint.start((id, timestamp) =>
      this.matcher.addRead(id!, timestamp.getTime()),
    );
    this.timer = setInterval(() => this.emit(Date.now()), 100);
    console.log(
      `[beam-openstint] pairing beam and reads within ${this.options.windowMs}ms`,
    );
  }

  /** Whatever is still waiting for a partner goes out as it stands. */
  stop(): void {
    clearInterval(this.timer);
    this.beam.stop();
    this.openstint.stop();
    this.emit(Infinity);
  }

  private emit(nowMs: number): void {
    for (const e of this.matcher.flush(nowMs)) {
      const send = forwarded(e, this.options.forwardBeamOnly);
      if (!send || !e.transponderId) {
        console.warn(
          `[beam-openstint] ${send ? 'unpaired' : 'dropped'} ${e.transponderId ? `read ${e.transponderId}` : 'beam'}: ${JSON.stringify(e.metadata)}`,
        );
      }
      if (!send) continue;
      this.onDetection?.(e.transponderId, new Date(e.timestampMs), e.metadata);
    }
  }
}

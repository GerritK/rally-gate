import { ChildProcess, execFileSync, spawn } from 'child_process';
import { createInterface } from 'readline';
import { DecoderAdapter, DetectionCallback } from './decoder-adapter';

export type BeamEdge = 'rising' | 'falling';

export interface BeamAdapterOptions {
  /** Line name, e.g. `GPIO17` — the same on every Pi model, unlike offsets. */
  line: string;
  /** Which edge means "beam broken". Depends on the sensor's Light-ON/Dark-ON mode. */
  edge: BeamEdge;
  /** Further edges within this window are the same car (wheels, wing, gaps). */
  lockoutMs: number;
}

/**
 * A light barrier on a GPIO pin, read through libgpiod's `gpiomon` rather than
 * a native Node module, so nothing has to compile on the Pi.
 *
 * Its timestamp is the kernel's, taken at the interrupt, so pipe and event-loop
 * latency don't reach the timing. It sees *that* a car passed, not which one:
 * detections carry no transponder and the server holds them for a marshal.
 */
export class BeamAdapter implements DecoderAdapter {
  private child?: ChildProcess;
  private lastAcceptedNs?: bigint;

  constructor(private readonly options: BeamAdapterOptions) {}

  start(onDetection: DetectionCallback): void {
    // Without gpiomon the gate times nothing, so exit and let systemd's restart
    // loop put the reason in the log gate-config shows.
    const fail = (reason: string) => {
      console.error(`[beam] ${reason} — is the gpiod package installed?`);
      process.exit(1);
    };
    let command: { command: string; args: string[] };
    try {
      command = gpiomonCommand(this.options);
    } catch (err) {
      return fail(`cannot run gpiomon/gpiofind (${(err as Error).message})`);
    }
    this.child = spawn(command.command, command.args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    createInterface({ input: this.child.stdout! }).on('line', (line) => {
      const eventNs = parseTimestampNs(line);
      if (eventNs === null) {
        console.warn(`[beam] unexpected gpiomon output: ${line}`);
        return;
      }
      if (
        !acceptTrigger(eventNs, this.lastAcceptedNs, this.options.lockoutMs)
      ) {
        return;
      }
      this.lastAcceptedNs = eventNs;
      onDetection(
        undefined,
        new Date(toWallClockMs(eventNs, process.hrtime.bigint(), Date.now())),
      );
    });
    this.child.stderr!.on('data', (chunk) =>
      console.error(`[beam] gpiomon: ${String(chunk).trim()}`),
    );
    this.child.on('error', (err) =>
      fail(`cannot run gpiomon (${err.message})`),
    );
    this.child.on('exit', (code) => {
      if (this.child) {
        console.error(`[beam] gpiomon exited with code ${code}`);
        process.exit(1);
      }
    });
    console.log(
      `[beam] watching ${this.options.line} for ${this.options.edge} edges, ${this.options.lockoutMs}ms lockout`,
    );
  }

  stop(): void {
    const child = this.child;
    this.child = undefined;
    child?.kill();
  }
}

/**
 * libgpiod v1 (Pi OS Bookworm) and v2 (Trixie) take different arguments: v1
 * needs chip + offset, looked up with `gpiofind`; v2 takes the line name.
 * Both report monotonic event timestamps.
 */
function gpiomonCommand({ line, edge }: BeamAdapterOptions): {
  command: string;
  args: string[];
} {
  const version = execFileSync('gpiomon', ['--version'], { encoding: 'utf8' });
  if (/v1\./.test(version)) {
    const [chip, offset] = execFileSync('gpiofind', [line], {
      encoding: 'utf8',
    })
      .trim()
      .split(/\s+/);
    return {
      command: 'gpiomon',
      args: [
        '--bias=pull-up',
        edge === 'rising' ? '--rising-edge' : '--falling-edge',
        '--format=%s %n',
        chip,
        offset,
      ],
    };
  }
  return {
    command: 'gpiomon',
    args: ['--bias=pull-up', `--edges=${edge}`, '--format=%S', line],
  };
}

/** `"<sec> <nsec>"` (v1) or `"<sec>.<nsec, 9 digits>"` (v2) to nanoseconds. */
export function parseTimestampNs(line: string): bigint | null {
  const match = /^(\d+)[ .](\d+)$/.exec(line.trim());
  return match ? BigInt(match[1]) * 1_000_000_000n + BigInt(match[2]) : null;
}

export function acceptTrigger(
  eventNs: bigint,
  lastAcceptedNs: bigint | undefined,
  lockoutMs: number,
): boolean {
  return (
    lastAcceptedNs === undefined ||
    eventNs - lastAcceptedNs >= BigInt(lockoutMs) * 1_000_000n
  );
}

/**
 * The event timestamp is CLOCK_MONOTONIC, which is also what
 * `process.hrtime` reads on Linux, so the edge happened `now - event` ago.
 * A lag outside 0-1s means the two clocks aren't the same after all; fall
 * back to receipt time rather than write a nonsense timestamp.
 */
export function toWallClockMs(
  eventNs: bigint,
  nowMonoNs: bigint,
  nowWallMs: number,
): number {
  const lagMs = Number(nowMonoNs - eventNs) / 1e6;
  if (lagMs < 0 || lagMs > 1000) {
    console.warn(
      `[beam] event timestamp ${lagMs}ms off the monotonic clock, using receipt time`,
    );
    return nowWallMs;
  }
  return nowWallMs - lagMs;
}

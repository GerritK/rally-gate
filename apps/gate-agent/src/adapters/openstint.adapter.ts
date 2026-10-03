import { ChildProcess, spawn } from 'child_process';
import { createInterface } from 'readline';
import { DecoderAdapter, DetectionCallback } from './decoder-adapter';

export interface OpenStintAdapterOptions {
  /** RTL-SDR tuner gain in dB, 0-40. */
  gain: number;
}

export interface Passing {
  timestampMs: number;
  transponderId: string;
  rssi: number;
  hits: number;
  mer?: number;
}

/**
 * OpenStint on an RTL-SDR, run as a child process and read from its stdout,
 * where it prints every passing it also publishes over ZeroMQ — so there is no
 * ZeroMQ client and nothing native to compile on the Pi.
 *
 * `-t` makes the reported timestamp wall-clock. Upstream converts only at
 * report time (`reporting_timestamp` in src/commons.cpp); passing detection
 * itself stays on the steady clock, so `-t` changes nothing but the field.
 */
export class OpenStintAdapter implements DecoderAdapter {
  private child?: ChildProcess;

  constructor(private readonly options: OpenStintAdapterOptions) {}

  start(onDetection: DetectionCallback): void {
    const fail = (reason: string) => {
      console.error(
        `[openstint] ${reason} — is the openstint package installed?`,
      );
      process.exit(1);
    };
    // chrt: sample capture is hard real-time, a scheduling delay is a dropped
    // buffer (upstream's own unit runs it SCHED_FIFO 70). Allowed for an
    // unprivileged user by LimitRTPRIO= in the gate-agent unit.
    this.child = spawn(
      'chrt',
      [
        '-f',
        '70',
        'openstint_rtlsdr',
        '-t',
        '-g',
        String(this.options.gain),
        '-s',
        '/var/lib/openstint',
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );

    createInterface({ input: this.child.stdout! }).on('line', (line) => {
      const passing = parsePassing(line);
      if (!passing) {
        return;
      }
      console.log(
        `[openstint] passing ${passing.transponderId} rssi ${passing.rssi} hits ${passing.hits} mer ${passing.mer ?? '?'}`,
      );
      onDetection(
        passing.transponderId,
        new Date(toWallClockMs(passing.timestampMs, Date.now())),
      );
    });
    this.child.stderr!.on('data', (chunk) =>
      console.error(`[openstint] ${String(chunk).trim()}`),
    );
    this.child.on('error', (err) =>
      fail(`cannot run openstint_rtlsdr (${err.message})`),
    );
    this.child.on('exit', (code) => {
      if (this.child) {
        console.error(`[openstint] openstint_rtlsdr exited with code ${code}`);
        process.exit(1);
      }
    });
    console.log(`[openstint] starting decoder, gain ${this.options.gain}dB`);
  }

  stop(): void {
    const child = this.child;
    this.child = undefined;
    child?.kill();
  }
}

/**
 * `P <timestamp_ms> <OPN|AMB> <id> <rssi> <hits> <pass_duration_us> <mer> [...]`.
 * Fields are positional and upstream reserves the right to append more, so
 * only a minimum length is checked. OPN and AMB ids are separate namespaces;
 * see "Multiple IDs per vehicle" in docs/decoder-adapters.md.
 */
export function parsePassing(line: string): Passing | null {
  const parts = line.trim().split(/\s+/);
  if (parts[0] !== 'P' || parts.length < 6) {
    return null;
  }
  const timestampMs = Number(parts[1]);
  const transponderId = parts[3];
  const rssi = Number(parts[4]);
  const hits = Number(parts[5]);
  if (!Number.isFinite(timestampMs) || !/^\d+$/.test(transponderId)) {
    return null;
  }
  const mer = parts.length > 7 ? Number(parts[7]) : undefined;
  return { timestampMs, transponderId, rssi, hits, mer };
}

/**
 * A passing is reported ~250ms after the car leaves the loop, so its timestamp
 * lags receipt by about that. Outside 0-5s it isn't wall-clock (decoder
 * started without `-t`) or the clock stepped; fall back to receipt time rather
 * than publish a nonsense timestamp.
 */
export function toWallClockMs(timestampMs: number, nowMs: number): number {
  const lagMs = nowMs - timestampMs;
  if (lagMs < 0 || lagMs > 5000) {
    console.warn(
      `[openstint] passing timestamp ${lagMs}ms off the system clock, using receipt time`,
    );
    return nowMs;
  }
  return timestampMs;
}

import {
  BUZZER_GAP_MS,
  BUZZER_SIGNAL_GAP_MS,
  BUZZER_SIGNALS,
  BuzzerSignal,
} from '@rally-gate/shared';
import { execFile, execFileSync } from 'child_process';
import { setTimeout as sleep } from 'timers/promises';
import { promisify } from 'util';
import { findLine, isLibgpiodV1 } from './gpio';
import { log } from './log';

const run = promisify(execFile);

const BEEP_MS = 120;
const MAX_PENDING = 3;

type Command = [command: string, args: string[]];

/**
 * v1's `--mode=time` releases the line still high, hence its second call.
 * v2's toggle list ends in a 0 period, which makes gpioset exit after it.
 */
export function beepCommands(
  v1Line: [chip: string, offset: string] | null,
  line: string,
  ms: number,
): Command[] {
  if (v1Line) {
    const [chip, offset] = v1Line;
    return [
      ['gpioset', ['--mode=time', `--usec=${ms * 1000}`, chip, `${offset}=1`]],
      ['gpioset', [chip, `${offset}=0`]],
    ];
  }
  return [['gpioset', ['-t', `${ms}ms,0`, `${line}=1`]]];
}

interface Item {
  tones: readonly number[];
  passing: boolean;
  done: () => void;
}

/**
 * Never in the timing path: it beeps after the timestamp is taken, and a failure only logs.
 * `status` off silences every signal but `powerOn`; a passing always beeps.
 */
export class Buzzer {
  private tone: ((ms: number) => Command[]) | undefined;
  private readonly queue: Item[] = [];
  private busy = false;

  constructor(
    line: string,
    private readonly status = true,
  ) {
    try {
      const v1Line = isLibgpiodV1() ? findLine(line) : null;
      this.tone = (ms) => beepCommands(v1Line, line, ms);
      log.info(`buzzer on ${line}`);
    } catch (err) {
      log.error(
        `buzzer off: cannot run gpiod tools (${(err as Error).message})`,
      );
    }
  }

  /** Capped, so a noisy beam can't keep it beeping long after. */
  beep(): void {
    const waiting = this.queue.filter((item) => item.passing).length;
    if (waiting < MAX_PENDING) {
      void this.enqueue([BEEP_MS], true);
    }
  }

  /** Resolves once played, or at once when the signal is not wanted. */
  play(signal: BuzzerSignal): Promise<void> {
    if (!this.wants(signal)) {
      return Promise.resolve();
    }
    return this.enqueue(BUZZER_SIGNALS[signal], false);
  }

  /** For a process that is exiting: only synchronous work runs in `exit`. */
  playSync(signal: BuzzerSignal): void {
    if (!this.tone || !this.wants(signal)) {
      return;
    }
    try {
      for (const ms of BUZZER_SIGNALS[signal]) {
        for (const [command, args] of this.tone(ms)) {
          execFileSync(command, args);
        }
        Atomics.wait(
          new Int32Array(new SharedArrayBuffer(4)),
          0,
          0,
          BUZZER_GAP_MS,
        );
      }
    } catch (err) {
      log.error(`buzzer: ${(err as Error).message}`);
    }
  }

  private wants(signal: BuzzerSignal): boolean {
    return this.status || signal === 'powerOn';
  }

  private enqueue(tones: readonly number[], passing: boolean): Promise<void> {
    if (!this.tone) {
      return Promise.resolve();
    }
    return new Promise((done) => {
      this.queue.push({ tones, passing, done });
      if (!this.busy) {
        this.busy = true;
        void this.drain();
      }
    });
  }

  private async drain(): Promise<void> {
    let previous: Item | undefined;
    for (let item = this.queue.shift(); item; item = this.queue.shift()) {
      // Passings follow each other at the tone gap; a signal stands apart.
      if (previous && !(previous.passing && item.passing)) {
        await sleep(BUZZER_SIGNAL_GAP_MS - BUZZER_GAP_MS);
      }
      previous = item;
      for (const ms of item.tones) {
        try {
          for (const [command, args] of this.tone!(ms)) {
            await run(command, args);
          }
        } catch (err) {
          log.error(`buzzer: ${(err as Error).message}`);
        }
        await sleep(BUZZER_GAP_MS);
      }
      item.done();
    }
    this.busy = false;
  }
}

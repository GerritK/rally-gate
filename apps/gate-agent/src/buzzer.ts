import { execFile } from 'child_process';
import { setTimeout as sleep } from 'timers/promises';
import { promisify } from 'util';
import { findLine, isLibgpiodV1 } from './gpio';
import { log } from './log';

const run = promisify(execFile);

const BEEP_MS = 120;
const GAP_MS = 100;
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

/** Never in the timing path: it beeps after the timestamp is taken, and a failure only logs. */
export class Buzzer {
  private readonly commands: Command[] = [];
  private busy = false;
  private pending = 0;

  constructor(line: string) {
    try {
      this.commands = beepCommands(
        isLibgpiodV1() ? findLine(line) : null,
        line,
        BEEP_MS,
      );
      log.info(`buzzer on ${line}`);
    } catch (err) {
      log.error(
        `buzzer off: cannot run gpiod tools (${(err as Error).message})`,
      );
    }
  }

  /** Capped, so a noisy beam can't keep it beeping long after. */
  beep(): void {
    if (this.commands.length === 0) {
      return;
    }
    this.pending = Math.min(this.pending + 1, MAX_PENDING);
    if (this.busy) {
      return;
    }
    this.busy = true;
    void (async () => {
      while (this.pending > 0) {
        this.pending--;
        try {
          for (const [command, args] of this.commands) {
            await run(command, args);
          }
        } catch (err) {
          log.error(`buzzer: ${(err as Error).message}`);
        }
        await sleep(GAP_MS);
      }
      this.busy = false;
    })();
  }
}

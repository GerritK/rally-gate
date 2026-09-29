import { execFile } from 'child_process';
import { log } from './log';

/**
 * Makes chrony re-resolve MQTT_HOST, its only time source.
 *
 * chrony resolves a source name once and, if that failed (gate booted before
 * the server), retries only after hours — so the gate stays unsynced while
 * timing fine. Called on every broker connect, which proves the name resolves
 * now and also catches the server moving to a new IP. Re-resolves only, never
 * steps the clock itself.
 *
 * Linux only: Windows 11 ships its own `sudo`, which can raise UAC in the dev
 * loop. `-n`: never block on a password prompt; a Linux box without the
 * sudoers rule or chrony just logs and moves on.
 */
export function refreshTimeSource(): void {
  if (process.platform !== 'linux') {
    return;
  }
  execFile('sudo', ['-n', 'chronyc', 'refresh'], (err) => {
    if (err) {
      log.warn(`chronyc refresh failed: ${err.message}`);
    }
  });
}

export interface ChronyState {
  chronySynced: boolean;
  chronyOffsetMs: number;
}

/**
 * chrony's tracking state, for the heartbeat. `tracking` is a monitoring
 * command, so no sudo. Undefined off Linux or when chronyc fails — the
 * dashboard then shows nothing rather than a false "not synced".
 */
export function readChrony(): Promise<ChronyState | undefined> {
  if (process.platform !== 'linux') {
    return Promise.resolve(undefined);
  }
  return new Promise((resolve) => {
    execFile('chronyc', ['-c', 'tracking'], { timeout: 2000 }, (err, stdout) =>
      resolve(err ? undefined : parseTracking(stdout)),
    );
  });
}

/**
 * `chronyc -c tracking` is one CSV line: field 4 is the system time offset in
 * seconds, the last field the leap status. The offset's sign is taken as
 * absolute — which way the clock is off doesn't change whether it's usable.
 */
export function parseTracking(csv: string): ChronyState | undefined {
  const fields = csv.trim().split(',');
  const offsetS = Number(fields[4]);
  if (fields.length < 14 || Number.isNaN(offsetS)) {
    return undefined;
  }
  return {
    chronySynced: fields[fields.length - 1] !== 'Not synchronised',
    chronyOffsetMs: Math.abs(offsetS) * 1000,
  };
}

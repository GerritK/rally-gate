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

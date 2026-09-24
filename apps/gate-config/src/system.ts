import { execFile } from 'child_process';
import { mkdirSync, writeFileSync } from 'fs';
import { promisify } from 'util';

const run = promisify(execFile);

/**
 * Every call into the operating system lives here, deliberately.
 *
 * None of it can run on a developer machine — systemd, chrony and
 * NetworkManager are all Pi-only — so isolating it keeps the rest of this
 * service unit-testable and makes the untested surface one small, obvious file
 * rather than a scattering of shell-outs. Treat changes here as changes that
 * only real hardware can verify.
 *
 * `execFile`, never `exec`: arguments are passed as a list rather than through
 * a shell, so a value that reaches one of these cannot become another command.
 * The sudoers rules in deploy/install-gate-pi.sh permit exactly these commands.
 */
const AGENT_UNIT = 'rally-gate-agent';

/** Where chrony picks up dynamically supplied servers; see gate-config-ui.md. */
const CHRONY_SOURCE_DIR = process.env.CHRONY_SOURCE_DIR ?? '/run/chrony-rally';
const NTP_PORT = process.env.NTP_PORT ?? '57433';

export interface CommandResult {
  ok: boolean;
  output: string;
}

async function attempt(
  command: string,
  args: string[],
): Promise<CommandResult> {
  try {
    const { stdout } = await run(command, args, { timeout: 10_000 });
    return { ok: true, output: stdout.trim() };
  } catch (err) {
    // Reported rather than thrown: several of these are expected to fail on a
    // gate that is simply not set up that way yet (no chrony, no wifi), and a
    // status page that 500s because one probe failed is worse than one that
    // says "unknown" for that row.
    const e = err as { stdout?: string; stderr?: string; message: string };
    return { ok: false, output: (e.stderr || e.stdout || e.message).trim() };
  }
}

export function restartAgent(): Promise<CommandResult> {
  return attempt('sudo', ['systemctl', 'restart', AGENT_UNIT]);
}

export function agentActive(): Promise<CommandResult> {
  return attempt('systemctl', ['is-active', AGENT_UNIT]);
}

export function clockTracking(): Promise<CommandResult> {
  return attempt('chronyc', ['tracking']);
}

export function recentLog(lines = 20): Promise<CommandResult> {
  return attempt('journalctl', [
    '-u',
    AGENT_UNIT,
    '-n',
    String(lines),
    '--no-pager',
    '--output',
    'short-iso',
  ]);
}

/**
 * Points chrony at whatever rally-server address is now configured.
 *
 * Without this, changing MQTT_HOST leaves the clock synced to the previous
 * host and the gate drifts away from the rest of the rally — silently, since
 * detections keep flowing. See "Clock offset" in docs/architecture.md.
 *
 * Deliberately a sourcedir reload rather than rewriting conf.d and restarting
 * chrony: Debian's default `makestep 1 3` steps the clock on the first updates
 * after a start, and a step mid-stage writes a discontinuity straight into a
 * running StageRun (docs/decoder-adapters.md, "Gate system clock policy").
 * `chronyc reload sources` adds and drops servers without that.
 */
export async function applyTimeSource(host: string): Promise<CommandResult> {
  try {
    mkdirSync(CHRONY_SOURCE_DIR, { recursive: true });
    writeFileSync(
      `${CHRONY_SOURCE_DIR}/rally-server.sources`,
      `server ${host} port ${NTP_PORT} iburst prefer minpoll 4 maxpoll 6\n`,
    );
  } catch (err) {
    return { ok: false, output: (err as Error).message };
  }
  return attempt('sudo', ['chronyc', 'reload', 'sources']);
}

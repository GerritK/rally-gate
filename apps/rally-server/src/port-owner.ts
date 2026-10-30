import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** `users:(("node",pid=1234,fd=20))` from `ss -p` → `node (PID 1234)`. */
export function parseSsOwner(output: string): string | null {
  const match = /users:\(\("([^"]+)",pid=(\d+)/.exec(output);
  return match ? `${match[1]} (PID ${match[2]})` : null;
}

async function findOwner(
  port: number,
  protocol: 'tcp' | 'udp',
): Promise<string | null> {
  try {
    if (process.platform === 'win32') {
      const cmdlet =
        protocol === 'tcp' ? 'Get-NetTCPConnection' : 'Get-NetUDPEndpoint';
      const { stdout } = await run('powershell', [
        '-NoProfile',
        '-Command',
        `$p = (${cmdlet} -LocalPort ${port} -ErrorAction SilentlyContinue | Where-Object OwningProcess -gt 0 | Select-Object -First 1).OwningProcess; ` +
          `if ($p) { "$((Get-Process -Id $p).ProcessName) (PID $p)" }`,
      ]);
      return stdout.trim() || null;
    }
    // shortcut: Linux only; macOS gets the generic hint until a marshal needs lsof there.
    const { stdout } = await run('ss', [
      protocol === 'tcp' ? '-Htanp' : '-Huanp',
      `sport = :${port}`,
    ]);
    return parseSsOwner(stdout);
  } catch {
    return null;
  }
}

/**
 * What to tell a marshal when a port can't be bound. The ports sit inside the
 * OS ephemeral range, so the culprit is often not a second rally-server but
 * any program's outgoing socket — and on Windows a socket that is only Bound
 * appears in Get-NetTCPConnection, not in `netstat -ano`.
 */
export async function portClashHint(
  port: number,
  protocol: 'tcp' | 'udp',
  err: NodeJS.ErrnoException,
): Promise<string> {
  if (err.code === 'EACCES' && process.platform === 'win32') {
    return ` — Windows has reserved port ${port} (Hyper-V, WSL and Docker take port blocks at boot); restart Windows, or check \`netsh int ipv4 show excludedportrange ${protocol}\``;
  }
  if (err.code !== 'EADDRINUSE') {
    return '';
  }
  const owner = await findOwner(port, protocol);
  if (owner) {
    return ` — ${owner} holds port ${port}/${protocol}; close it and start again`;
  }
  return process.platform === 'win32'
    ? ` — another program holds port ${port}/${protocol} (a second rally-server, or any program's connection); find it with \`Get-NetTCPConnection -LocalPort ${port}\` in PowerShell, netstat does not list it`
    : ` — another program holds port ${port}/${protocol} (a second rally-server, or any program's connection); find it with \`sudo ss -tanup 'sport = :${port}'\``;
}

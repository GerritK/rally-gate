import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Logger } from '@nestjs/common';

const run = promisify(execFile);
const RULE_NAME = 'rally-gate';

/**
 * Opens this server's ports in Windows Firewall, asking for admin once via UAC.
 *
 * Port rules rather than trusting Windows' own "allow node.exe" prompt: that
 * rule matches the resolved executable, and nvm-windows puts node.exe behind a
 * symlink, so the rule silently stops matching after a Node switch — and it is
 * only created for whichever network category was ticked in the prompt.
 *
 * Every profile, because Windows files a newly joined venue network as Public,
 * but only from the local subnet: that is where gates are, and it keeps the
 * unauthenticated API and broker closed to anything routed in from further out.
 */
export async function ensureWindowsFirewall(): Promise<void> {
  if (process.platform !== 'win32') {
    return;
  }
  const logger = new Logger('WindowsFirewall');

  // ponytail: checks the rule exists, not its ports; delete the "rally-gate"
  // rules after changing PORT/MQTT_PORT/NTP_PORT and they are recreated.
  try {
    await run('netsh', [
      'advfirewall',
      'firewall',
      'show',
      'rule',
      `name=${RULE_NAME}`,
    ]);
    return;
  } catch {
    // netsh exits 1 when no rule matches.
  }

  const tcp = [process.env.PORT ?? 57430, process.env.MQTT_PORT ?? 57431];
  const udp = [process.env.NTP_PORT ?? 57432, 5353];
  const rule = (protocol: string, ports: (string | number)[]) =>
    `New-NetFirewallRule -DisplayName '${RULE_NAME}' -Direction Inbound ` +
    `-Action Allow -Profile Any -RemoteAddress LocalSubnet ` +
    `-Protocol ${protocol} -LocalPort ${ports.join(',')}`;
  const elevated = Buffer.from(
    `${rule('TCP', tcp)}; ${rule('UDP', udp)}`,
    'utf16le',
  ).toString('base64');

  logger.log('Asking for admin rights once to open the gate ports (UAC)…');
  try {
    await run('powershell', [
      '-NoProfile',
      '-Command',
      `Start-Process powershell -Verb RunAs -Wait -WindowStyle Hidden ` +
        `-ArgumentList '-NoProfile','-EncodedCommand','${elevated}'`,
    ]);
    logger.log(
      `Opened TCP ${tcp.join(',')} and UDP ${udp.join(',')} for the local subnet`,
    );
  } catch {
    logger.warn(
      'Firewall not opened (UAC declined?) — gates on other machines cannot ' +
        'connect. Restart the server to be asked again.',
    );
  }
}

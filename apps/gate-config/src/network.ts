/**
 * Pure parsing and validation for the Wi-Fi settings, kept out of `system.ts`
 * so it is unit-testable: `system.ts` is the deliberately-untested surface that
 * only a Pi can exercise, this is not.
 *
 * Everything here reads `nmcli --terse` output, whose format is a stable,
 * documented, machine-readable contract — unlike the journal text the status
 * panel shows verbatim (see docs/gate-config-ui.md, "What the page shows").
 */

/**
 * `nmcli -t` separates fields with `:` and backslash-escapes any `:` that
 * occurs inside a value — an SSID may legitimately contain one, so a plain
 * `split(':')` silently truncates those networks out of the list.
 */
export function splitTerse(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '\\' && i + 1 < line.length) {
      current += line[i + 1];
      i += 1;
    } else if (char === ':') {
      fields.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
}

export interface DeviceStatus {
  device: string;
  type: string;
  state: string;
  connection: string;
}

/** Parses `nmcli -t -f DEVICE,TYPE,STATE,CONNECTION device status`. */
export function parseDeviceStatus(output: string): DeviceStatus[] {
  return output
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const [device = '', type = '', state = '', connection = ''] =
        splitTerse(line);
      return { device, type, state, connection };
    });
}

export interface WifiNetwork {
  ssid: string;
  signal: number;
  secured: boolean;
}

/**
 * Parses `nmcli -t -f SSID,SIGNAL,SECURITY device wifi list`.
 *
 * Deduplicated by SSID keeping the strongest reading, because a mesh or an
 * extender puts the same network on screen three times with different
 * strengths, and a marshal picking from that list is choosing a network, not a
 * radio. Hidden networks come back with an empty SSID and are dropped — there
 * is nothing to click; the combobox accepts a typed name for that case.
 */
export function parseWifiList(output: string): WifiNetwork[] {
  const strongest = new Map<string, WifiNetwork>();
  for (const line of output.split(/\r?\n/)) {
    if (line.trim() === '') {
      continue;
    }
    const [ssid = '', signal = '', security = ''] = splitTerse(line);
    if (ssid === '') {
      continue;
    }
    const network: WifiNetwork = {
      ssid,
      signal: Number(signal) || 0,
      // nmcli prints `--` for an open network, and a key management name
      // (WPA2, WPA3, WEP, 802.1X) for everything else.
      secured: security !== '' && security !== '--',
    };
    const seen = strongest.get(ssid);
    if (!seen || seen.signal < network.signal) {
      strongest.set(ssid, network);
    }
  }
  return [...strongest.values()].sort((a, b) => b.signal - a.signal);
}

/**
 * The boundary for the join endpoint. The Wi-Fi password never touches
 * `gate.env` — it goes to NetworkManager, which stores it 0600 under
 * `/etc/NetworkManager/system-connections`, so it is neither written by this
 * service nor readable back through `GET /api/config`.
 *
 * The leading-hyphen rule is the one that is not cosmetic: arguments reach
 * `nmcli` through `execFile`, so they can never become a second *command*, but
 * a value starting with `-` would still be read by nmcli as one of its own
 * options rather than as the SSID.
 */
export function validateWifi(input: {
  ssid?: unknown;
  password?: unknown;
}): Record<string, string> {
  const errors: Record<string, string> = {};
  const { ssid, password } = input;

  if (typeof ssid !== 'string' || ssid === '') {
    errors.ssid = 'Pick a network or type its name.';
  } else if (Buffer.byteLength(ssid, 'utf8') > 32) {
    errors.ssid = 'Network names are at most 32 bytes.';
  } else if (/[\r\n\0]/.test(ssid)) {
    errors.ssid = 'Must not contain line breaks.';
  } else if (ssid.startsWith('-')) {
    errors.ssid = 'Cannot start with a hyphen.';
  }

  // Empty means an open network, which is a real thing to join.
  if (password !== undefined && password !== '') {
    if (typeof password !== 'string') {
      errors.password = 'Must be text.';
    } else if (!/^[\x20-\x7e]{8,63}$/.test(password)) {
      errors.password = 'Wi-Fi passwords are 8 to 63 printable characters.';
    }
  }

  return errors;
}

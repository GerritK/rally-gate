import { randomBytes } from 'crypto';
import { readFileSync, renameSync, unlinkSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';

export const CONFIG_PATH =
  process.env.GATE_CONFIG_FILE ?? '/etc/rally-gate/gate.env';

/**
 * The settable keys, as a whitelist rather than a blocklist.
 *
 * This file is read by systemd as `EnvironmentFile=` for the gate-agent unit,
 * so every key in it becomes an environment variable of that process.
 *
 * `group` decides which card on the page a field lands in; it is here rather
 * than in the Vue component so the two cannot disagree about where a new
 * setting belongs. Anything without one goes in the general card.
 *
 * Accepting an arbitrary key name would therefore let anyone who can reach this
 * service set `NODE_OPTIONS`, `LD_PRELOAD` or `PATH` and run code as the
 * gate-agent user — the service has no authentication (see
 * docs/gate-config-ui.md "Access"), so the whitelist *is* the boundary. Never
 * widen this to "anything the form posted".
 */
export const FIELDS = {
  GATE_ID: {
    label: 'Gate ID',
    // Matches what the server accepts as a Gate primary key, and stays within
    // what a host name can be derived from (see install-gate-pi.sh).
    pattern: /^[A-Za-z0-9_-]{1,64}$/,
    message: 'Use letters, digits, underscore and hyphen only (max 64).',
    hint: 'Identity on the server — changing it makes the old one a separate gate.',
  },
  MQTT_HOST: {
    label: 'rally-server address',
    // Host name or IP. Deliberately not a strict hostname grammar: `.local`
    // names, bare IPv4 and IPv6 literals all have to pass.
    pattern: /^[A-Za-z0-9._:-]{1,253}$/,
    message: 'Use a host name or IP address.',
    hint: 'Default rally-server.local is discovered over mDNS; an address here overrides it.',
  },
  MQTT_PORT: {
    label: 'MQTT port',
    range: [1, 65535] as const,
    message: 'Must be a port between 1 and 65535.',
    hint: 'Default 57431.',
  },
  ADAPTER: {
    group: 'decoder',
    label: 'Decoder',
    oneOf: ['simulated'] as const,
    message: 'Pick one of the listed decoders.',
    hint: 'Only the simulator exists today.',
  },
  TRANSPONDERS: {
    group: 'decoder',
    label: 'Simulated transponders',
    pattern: /^[0-9]+(,[0-9]+)*$/,
    message: 'Comma-separated digits, e.g. 1234567,7654321.',
    hint: 'Simulator only.',
  },
  SIMULATE_INTERVAL_MS: {
    group: 'decoder',
    label: 'Simulated interval (ms)',
    // Lower bound because the simulator drives the real publish path: a 1ms
    // interval is a flood at the broker, not a test.
    range: [250, 3_600_000] as const,
    message: 'Must be between 250 and 3600000 ms.',
    hint: 'Leave empty to publish no simulated detections.',
  },
  HOTSPOT_PASSWORD: {
    label: 'Hotspot password',
    // WPA2's own limits: 8-63 printable ASCII. Not a generated secret — the
    // installer prints it and the organiser needs it on a sticker, so it is
    // predictable on purpose (docs/gate-config-ui.md, "Access"). It is also
    // readable through GET /api/config like every other field, which is
    // consistent: anyone already on the rally network is inside the boundary
    // this password exists to draw around the gate's *own* access point.
    pattern: /^[\x20-\x7e]{8,63}$/,
    message: 'Must be 8 to 63 printable characters.',
    hint: 'For the rally-gate-<hostname> network this gate raises when it can reach no Wi-Fi. Default rally-gate.',
  },
  HEARTBEAT_INTERVAL_MS: {
    label: 'Heartbeat interval (ms)',
    // Upper bound tied to the dashboard's 30s offline threshold: anything
    // slower makes a healthy gate read as offline.
    range: [1_000, 30_000] as const,
    message: 'Must be between 1000 and 30000 ms.',
    hint: 'Default 15000. Slower than 30000 and the server reads this gate as offline.',
  },
} as const;

/**
 * The browser-safe description of each field, which the page turns into input
 * rules.
 *
 * Sent so client-side validation is *derived* from this one definition rather
 * than hand-written a second time in the Vue component, where the two would
 * drift and a marshal would meet a rule the server does not have — or worse,
 * not meet one it does. `config-file.spec.ts` asserts the two paths agree.
 *
 * Client-side rules stay a convenience: `validate` below is the boundary and
 * runs on every save regardless of what the browser did. Exposing a pattern
 * costs nothing; it is a grammar, not a secret.
 */
/** What the browser receives. Named so the wire contract is explicit rather
 *  than inferred from `as const` specs, whose literal types are an
 *  implementation detail of the server's own checks. */
export interface FieldDescriptor {
  label: string;
  hint: string;
  message: string;
  group: FieldGroup;
  oneOf?: string[];
  pattern?: string;
  range?: [number, number];
}

export function fieldDescriptors(): Record<FieldName, FieldDescriptor> {
  return Object.fromEntries(
    (Object.entries(FIELDS) as [FieldName, FieldSpec][]).map(([name, spec]) => [
      name,
      {
        label: spec.label,
        hint: spec.hint,
        message: spec.message,
        group: 'group' in spec ? spec.group : 'general',
        oneOf: 'oneOf' in spec ? [...spec.oneOf] : undefined,
        // Source rather than the RegExp itself: JSON cannot carry one, and the
        // client rebuilds it with `new RegExp(...)`.
        pattern: 'pattern' in spec ? spec.pattern.source : undefined,
        range:
          'range' in spec ? ([...spec.range] as [number, number]) : undefined,
      },
    ]),
  ) as Record<FieldName, FieldDescriptor>;
}

/** Which card on the page a field appears in. */
export type FieldGroup = 'general' | 'decoder';

export type FieldName = keyof typeof FIELDS;
export type FieldSpec = (typeof FIELDS)[FieldName];
export type GateConfig = Partial<Record<FieldName, string>>;

export function isFieldName(key: string): key is FieldName {
  return Object.prototype.hasOwnProperty.call(FIELDS, key);
}

/**
 * Parses systemd's EnvironmentFile format, restricted to what this service
 * writes: `KEY=value`, `#` comments, blank lines. Quoting and line
 * continuations are not supported — values that would need them are rejected by
 * `validate`, so round-tripping stays exact.
 */
export function parseEnvFile(text: string): GateConfig {
  const config: GateConfig = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const separator = trimmed.indexOf('=');
    if (separator <= 0) {
      continue;
    }
    const key = trimmed.slice(0, separator).trim();
    if (isFieldName(key)) {
      config[key] = trimmed.slice(separator + 1).trim();
    }
  }
  return config;
}

export function serializeEnvFile(config: GateConfig): string {
  const lines = [
    '# Written by @rally-gate/gate-config. Read by the rally-gate-agent unit',
    '# via EnvironmentFile=. Edit through the gate config UI, or by hand while',
    '# gate-config is stopped.',
  ];
  for (const key of Object.keys(FIELDS) as FieldName[]) {
    const value = config[key];
    if (value !== undefined && value !== '') {
      lines.push(`${key}=${value}`);
    }
  }
  return lines.join('\n') + '\n';
}

/** Returns one error message per invalid field, keyed by field name. */
export function validate(
  input: Record<string, unknown>,
): Record<string, string> {
  const errors: Record<string, string> = {};

  for (const key of Object.keys(input)) {
    if (!isFieldName(key)) {
      errors[key] = 'Unknown setting.';
    }
  }

  for (const [key, spec] of Object.entries(FIELDS)) {
    const raw = input[key];
    if (raw === undefined || raw === '') {
      continue; // absent means "leave unset"; required-ness is the caller's call
    }
    if (typeof raw !== 'string') {
      errors[key] = 'Must be text.';
      continue;
    }
    // Checked before anything else: a newline would inject a second
    // KEY=value line into the file systemd reads, making every other
    // per-field rule bypassable.
    if (/[\r\n\0]/.test(raw)) {
      errors[key] = 'Must not contain line breaks.';
      continue;
    }
    // One message per field, taken from the spec, so the text a marshal reads is
    // identical whether the browser or the server produced it. `port` is gone as
    // a separate case: it was a range with another name, and one fewer case is
    // one fewer thing the client has to reimplement.
    if ('pattern' in spec && !spec.pattern.test(raw)) {
      errors[key] = spec.message;
    } else if (
      'oneOf' in spec &&
      !(spec.oneOf as readonly string[]).includes(raw)
    ) {
      errors[key] = spec.message;
    } else if ('range' in spec) {
      const value = Number(raw);
      const [min, max] = spec.range;
      if (!Number.isInteger(value) || value < min || value > max) {
        errors[key] = spec.message;
      }
    }
  }

  return errors;
}

export function readConfig(path = CONFIG_PATH): GateConfig {
  try {
    return parseEnvFile(readFileSync(path, 'utf8'));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return {};
    }
    throw err;
  }
}

/**
 * Written to a temporary file and renamed, never edited in place. rename(2) is
 * atomic within a filesystem, so a gate losing power mid-save — which happens,
 * it runs off a battery in a forest — leaves either the old config or the new
 * one, never half a line that systemd would then refuse to parse.
 */
export function writeConfig(config: GateConfig, path = CONFIG_PATH): void {
  const temporary = join(
    dirname(path),
    `.${randomBytes(6).toString('hex')}.tmp`,
  );
  try {
    writeFileSync(temporary, serializeEnvFile(config), { mode: 0o644 });
    renameSync(temporary, path);
  } catch (err) {
    try {
      unlinkSync(temporary);
    } catch {
      // Already gone, or never created — nothing to clean up either way.
    }
    throw err;
  }
}

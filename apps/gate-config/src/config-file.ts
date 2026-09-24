import { randomBytes } from 'crypto';
import { readFileSync, renameSync, unlinkSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';

export const CONFIG_PATH =
  process.env.GATE_CONFIG_FILE ?? '/etc/rally-gate/gate.env';

/**
 * The settable keys, as a whitelist rather than a blocklist.
 *
 * This file is read by systemd as `EnvironmentFile=` for the gate-agent unit,
 * so every key in it becomes an environment variable of that process. Accepting
 * an arbitrary key name would therefore let anyone who can reach this service
 * set `NODE_OPTIONS`, `LD_PRELOAD` or `PATH` and run code as the gate-agent
 * user — the service has no authentication (see docs/gate-config-ui.md
 * "Access"), so the whitelist *is* the boundary. Never widen this to "anything
 * the form posted".
 */
export const FIELDS = {
  GATE_ID: {
    label: 'Gate ID',
    // Matches what the server accepts as a Gate primary key, and stays within
    // what a host name can be derived from (see install-gate-pi.sh).
    pattern: /^[A-Za-z0-9_-]{1,64}$/,
    hint: 'Letters, digits, underscore and hyphen. Identity on the server — changing it makes the old one a separate gate.',
  },
  MQTT_HOST: {
    label: 'rally-server address',
    // Host name or IP. Deliberately not a strict hostname grammar: `.local`
    // names, bare IPv4 and IPv6 literals all have to pass.
    pattern: /^[A-Za-z0-9._:-]{1,253}$/,
    hint: 'Default rally-server.local is discovered over mDNS; an address here overrides it.',
  },
  MQTT_PORT: { label: 'MQTT port', port: true, hint: 'Default 57431.' },
  ADAPTER: {
    label: 'Decoder',
    oneOf: ['simulated'],
    hint: 'Only the simulator exists today.',
  },
  TRANSPONDERS: {
    label: 'Simulated transponders',
    pattern: /^[0-9]+(,[0-9]*[0-9])*$/,
    hint: 'Comma-separated, simulator only.',
  },
  SIMULATE_INTERVAL_MS: {
    label: 'Simulated interval (ms)',
    // Lower bound because the simulator drives the real publish path: a 1ms
    // interval is a flood at the broker, not a test.
    range: [250, 3_600_000] as const,
    hint: 'Leave empty to publish no simulated detections.',
  },
  HEARTBEAT_INTERVAL_MS: {
    label: 'Heartbeat interval (ms)',
    // Upper bound tied to the dashboard's 30s offline threshold: anything
    // slower makes a healthy gate read as offline.
    range: [1_000, 30_000] as const,
    hint: 'Default 15000. Above 30000 the server shows this gate as offline.',
  },
} as const;

export type FieldName = keyof typeof FIELDS;
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
    if ('pattern' in spec && !spec.pattern.test(raw)) {
      errors[key] = `Invalid ${spec.label.toLowerCase()}.`;
    } else if (
      'oneOf' in spec &&
      !(spec.oneOf as readonly string[]).includes(raw)
    ) {
      errors[key] = `Must be one of: ${spec.oneOf.join(', ')}.`;
    } else if ('port' in spec) {
      const port = Number(raw);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        errors[key] = 'Must be a port between 1 and 65535.';
      }
    } else if ('range' in spec) {
      const value = Number(raw);
      const [min, max] = spec.range;
      if (!Number.isInteger(value) || value < min || value > max) {
        errors[key] = `Must be a whole number between ${min} and ${max}.`;
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

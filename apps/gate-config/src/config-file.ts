import { randomBytes } from 'crypto';
import { readFileSync, renameSync, unlinkSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import type { FieldDescriptor, FieldError } from './api-types';

export const CONFIG_PATH =
  process.env.GATE_CONFIG_FILE ?? '/etc/rally-gate/gate.env';

/**
 * The settable keys, as a whitelist rather than a blocklist.
 *
 * This file is read by systemd as `EnvironmentFile=` for the gate-agent unit,
 * so every key in it becomes an environment variable of that process.
 *
 * `group` decides which card on the page a field lands in, and `adapter` that
 * it only shows while that decoder is selected; both are here rather than in
 * the Vue component so the two cannot disagree about where a new setting
 * belongs. Anything without a group goes in the general card. Labels, hints
 * and messages are the page's (`fields.<NAME>` in its locales), which
 * `config-file.spec.ts` checks every field here has.
 *
 * Accepting an arbitrary key name would therefore let anyone who can reach this
 * service set `NODE_OPTIONS`, `LD_PRELOAD` or `PATH` and run code as the
 * gate-agent user — the service has no authentication (see
 * docs/gate-config-ui.md "Access"), so the whitelist *is* the boundary. Never
 * widen this to "anything the form posted".
 */
export const FIELDS = {
  GATE_ID: {
    // Matches what the server accepts as a Gate primary key, and stays within
    // what a host name can be derived from (see install-gate-pi.sh).
    pattern: /^[A-Za-z0-9_-]{1,64}$/,
  },
  MQTT_HOST: {
    // Host name or IP. Deliberately not a strict hostname grammar: `.local`
    // names, bare IPv4 and IPv6 literals all have to pass.
    pattern: /^[A-Za-z0-9._:-]{1,253}$/,
  },
  MQTT_PORT: {
    range: [1, 65535] as const,
  },
  ADAPTER: {
    group: 'decoder',
    oneOf: ['simulated', 'beam'] as const,
  },
  BEAM_GPIO: {
    group: 'decoder',
    adapter: 'beam',
    // A line name rather than a pin number: the same on every Pi model, where
    // chip offsets are not.
    pattern: /^GPIO[0-9]{1,2}$/,
  },
  BEAM_EDGE: {
    group: 'decoder',
    adapter: 'beam',
    oneOf: ['rising', 'falling'] as const,
  },
  BEAM_LOCKOUT_MS: {
    group: 'decoder',
    adapter: 'beam',
    // Lower bound because a car body breaks the beam several times (wheels,
    // wing); upper because a second car closer than this is lost.
    range: [50, 10_000] as const,
  },
  TRANSPONDERS: {
    group: 'decoder',
    adapter: 'simulated',
    pattern: /^[0-9]+(,[0-9]+)*$/,
  },
  SIMULATE_INTERVAL_MS: {
    group: 'decoder',
    adapter: 'simulated',
    // Lower bound because the simulator drives the real publish path: a 1ms
    // interval is a flood at the broker, not a test.
    range: [250, 3_600_000] as const,
  },
  HOTSPOT_PASSWORD: {
    // WPA2's own limits: 8-63 printable ASCII. Not a generated secret — the
    // installer prints it and the organiser needs it on a sticker, so it is
    // predictable on purpose (docs/gate-config-ui.md, "Access"). It is also
    // readable through GET /api/config like every other field, which is
    // consistent: anyone already on the rally network is inside the boundary
    // this password exists to draw around the gate's *own* access point.
    pattern: /^[\x20-\x7e]{8,63}$/,
  },
  HEARTBEAT_INTERVAL_MS: {
    // Upper bound tied to the dashboard's 30s offline threshold: anything
    // slower makes a healthy gate read as offline.
    range: [1_000, 30_000] as const,
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
export function fieldDescriptors(): Record<FieldName, FieldDescriptor> {
  return Object.fromEntries(
    (Object.entries(FIELDS) as [FieldName, FieldSpec][]).map(([name, spec]) => [
      name,
      {
        group: 'group' in spec ? spec.group : 'general',
        adapter: 'adapter' in spec ? spec.adapter : undefined,
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

/** Returns one error code per invalid field, keyed by field name. */
export function validate(
  input: Record<string, unknown>,
): Record<string, FieldError> {
  const errors: Record<string, FieldError> = {};

  for (const key of Object.keys(input)) {
    if (!isFieldName(key)) {
      errors[key] = 'unknown';
    }
  }

  for (const [key, spec] of Object.entries(FIELDS)) {
    const raw = input[key];
    if (raw === undefined || raw === '') {
      continue; // absent means "leave unset"; required-ness is the caller's call
    }
    if (typeof raw !== 'string') {
      errors[key] = 'notText';
      continue;
    }
    // Checked before anything else: a newline would inject a second
    // KEY=value line into the file systemd reads, making every other
    // per-field rule bypassable.
    if (/[\r\n\0]/.test(raw)) {
      errors[key] = 'lineBreak';
      continue;
    }
    // One code for every rule, so the page shows the field's one message
    // whether the browser or the server caught it. `port` is gone as a
    // separate case: it was a range with another name, and one fewer case is
    // one fewer thing the client has to reimplement.
    if ('pattern' in spec && !spec.pattern.test(raw)) {
      errors[key] = 'invalid';
    } else if (
      'oneOf' in spec &&
      !(spec.oneOf as readonly string[]).includes(raw)
    ) {
      errors[key] = 'invalid';
    } else if ('range' in spec) {
      const value = Number(raw);
      const [min, max] = spec.range;
      if (!Number.isInteger(value) || value < min || value > max) {
        errors[key] = 'invalid';
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

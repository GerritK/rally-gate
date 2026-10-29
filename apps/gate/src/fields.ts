import { GATE_ID_PATTERN } from '@rally-gate/shared';
import type { FieldDescriptor, FieldError } from './gate-config/api-types';

/** A yes/no setting, kept as `on`/`off` and shown as a switch. */
const toggle = (initial: 'on' | 'off') =>
  ({ oneOf: ['on', 'off'] as const, toggle: true, default: initial }) as const;

/**
 * The settable keys, as a whitelist rather than a blocklist.
 *
 * This file is read by systemd as `EnvironmentFile=` for the gate-agent unit,
 * so every key in it becomes an environment variable of that process.
 *
 * `group` decides which card on the page a field lands in, and `adapters` that
 * it only shows while one of those decoders is selected; both are here rather than in
 * the Vue component so the two cannot disagree about where a new setting
 * belongs. Anything without a group goes in the general card. `default` is
 * what the agent runs with while a key is unset, and the page's placeholder. Labels, hints
 * and messages are the page's (`fields.<NAME>` in its locales), which
 * `fields.spec.ts` checks every field here has.
 *
 * Accepting an arbitrary key name would therefore let anyone who can reach this
 * service set `NODE_OPTIONS`, `LD_PRELOAD` or `PATH` and run code as the
 * gate-agent user — the service has no authentication (see
 * docs/gate-config-ui.md "Access"), so the whitelist *is* the boundary. Never
 * widen this to "anything the form posted".
 */
export const FIELDS = {
  GATE_ID: {
    default: 'START_WP1',
    pattern: GATE_ID_PATTERN,
  },
  MQTT_HOST: {
    default: 'localhost',
    // Host name or IP. Deliberately not a strict hostname grammar: `.local`
    // names, bare IPv4 and IPv6 literals all have to pass.
    pattern: /^[A-Za-z0-9._:-]{1,253}$/,
  },
  MQTT_PORT: {
    default: '57431',
    range: [1, 65535] as const,
  },
  ADAPTER: {
    default: 'simulated',
    group: 'decoder',
    oneOf: ['simulated', 'beam', 'openstint', 'beam-openstint'] as const,
  },
  OPENSTINT_GAIN: {
    default: '20',
    group: 'decoder',
    adapters: ['openstint', 'beam-openstint'],
    range: [0, 40] as const,
  },
  BEAM_GPIO: {
    default: '17',
    group: 'decoder',
    adapters: ['beam', 'beam-openstint'],
    // The BCM number, as in the line name `GPIO17`: the same on every Pi
    // model, where chip offsets are not. 2-27 are the header's GPIOs.
    range: [2, 27] as const,
  },
  BEAM_EDGE: {
    default: 'rising',
    group: 'decoder',
    adapters: ['beam', 'beam-openstint'],
    oneOf: ['rising', 'falling'] as const,
  },
  BEAM_LOCKOUT_MS: {
    default: '500',
    group: 'decoder',
    adapters: ['beam', 'beam-openstint'],
    // Lower bound because a car body breaks the beam several times (wheels,
    // wing); upper because a second car closer than this is lost.
    range: [50, 10_000] as const,
  },
  PAIR_WINDOW_MS: {
    default: '500',
    group: 'decoder',
    adapters: ['beam-openstint'],
    // Wide enough for the beam and the loop not being at quite the same spot,
    // narrow enough that the car behind is not in it.
    range: [20, 2_000] as const,
  },
  FORWARD_BEAM_ONLY: {
    group: 'decoder',
    adapters: ['beam-openstint'],
    ...toggle('off'),
  },
  TRANSPONDERS: {
    default: '1234567',
    group: 'decoder',
    adapters: ['simulated'],
    pattern: /^[0-9]+(,[0-9]+)*$/,
  },
  SIMULATE_INTERVAL_MS: {
    group: 'decoder',
    adapters: ['simulated'],
    // Lower bound because the simulator drives the real publish path: a 1ms
    // interval is a flood at the broker, not a test.
    range: [250, 3_600_000] as const,
  },
  BUZZER_GPIO: {
    group: 'decoder',
    range: [2, 27] as const,
  },
  BUZZER_STATUS: {
    group: 'decoder',
    ...toggle('on'),
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
    default: '15000',
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
 * not meet one it does. `fields.spec.ts` asserts the two paths agree.
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
        adapters: 'adapters' in spec ? [...spec.adapters] : undefined,
        oneOf: 'oneOf' in spec ? [...spec.oneOf] : undefined,
        toggle: 'toggle' in spec ? spec.toggle : undefined,
        default: 'default' in spec ? spec.default : undefined,
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

/**
 * What the agent runs with: every field from `env`, its default where unset,
 * and `invalid` naming the fields that break their rule. An invalid field
 * falls back to its default too, so `beep-cli` still finds the buzzer; the
 * agent itself refuses to start (`EXIT_CONFIG_INVALID`) rather than time with
 * it, since a typo in `gate.env` by hand never passed through `validate`.
 */
export function readSettings(env: Record<string, string | undefined>): {
  settings: GateConfig;
  invalid: FieldName[];
} {
  const given = Object.fromEntries(
    Object.keys(FIELDS).map((name) => [name, env[name] ?? '']),
  );
  const invalid = Object.keys(validate(given)) as FieldName[];
  const settings: GateConfig = {};
  for (const [name, spec] of Object.entries(FIELDS) as [
    FieldName,
    FieldSpec,
  ][]) {
    const fallback = 'default' in spec ? spec.default : undefined;
    settings[name] =
      given[name] && !invalid.includes(name) ? given[name] : fallback;
  }
  return { settings, invalid };
}

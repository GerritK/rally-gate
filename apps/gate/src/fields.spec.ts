import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync } from 'fs';
import { describe, it } from 'node:test';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  FIELDS,
  FieldName,
  fieldDescriptors,
  readSettings,
  validate,
} from './fields';
import {
  parseEnvFile,
  readConfig,
  serializeEnvFile,
  writeConfig,
} from './gate-config/config-file';

function scratchFile(): string {
  return join(mkdtempSync(join(tmpdir(), 'gate-config-')), 'gate.env');
}

describe('parseEnvFile', () => {
  it('reads keys, ignoring comments and blank lines', () => {
    assert.deepEqual(
      parseEnvFile('# a comment\n\nGATE_ID=CLUB_START_WP1\nMQTT_PORT=57431\n'),
      { GATE_ID: 'CLUB_START_WP1', MQTT_PORT: '57431' },
    );
  });

  it('drops keys that are not settable, so a hand-edited file cannot smuggle them back', () => {
    assert.deepEqual(parseEnvFile('GATE_ID=G1\nLD_PRELOAD=/tmp/evil.so\n'), {
      GATE_ID: 'G1',
    });
  });

  it('round-trips through serialize', () => {
    const config = { GATE_ID: 'G1', MQTT_HOST: 'rally-server.local' };
    assert.deepEqual(parseEnvFile(serializeEnvFile(config)), config);
  });

  it('omits empty values rather than writing a blank assignment', () => {
    assert.ok(
      !serializeEnvFile({ GATE_ID: 'G1', TRANSPONDERS: '' }).includes(
        'TRANSPONDERS',
      ),
    );
  });
});

describe('validate', () => {
  it('accepts a realistic configuration', () => {
    assert.deepEqual(
      validate({
        GATE_ID: 'CLUB_START_WP1',
        MQTT_HOST: 'rally-server.local',
        MQTT_PORT: '57431',
        ADAPTER: 'simulated',
        TRANSPONDERS: '1234567,7654321',
        HEARTBEAT_INTERVAL_MS: '15000',
      }),
      {},
    );
  });

  it('rejects an unknown key instead of ignoring it', () => {
    assert.ok(
      'NODE_OPTIONS' in validate({ NODE_OPTIONS: '--require /tmp/x.js' }),
    );
  });

  // The one that matters most: a line break would append a second KEY=value
  // line to the file systemd reads as EnvironmentFile, which makes every
  // per-field rule below it bypassable and runs code as the gate-agent user.
  for (const [label, value] of [
    ['a line feed', 'G1\nLD_PRELOAD=/tmp/evil.so'],
    ['a carriage return', 'G1\rLD_PRELOAD=/tmp/evil.so'],
    // Built rather than written as a '\u0000' escape: prettier rewrites that
    // into a raw NUL byte in the source, which is invisible in a diff and
    // does not survive every editor.
    ['a null byte', 'G1' + String.fromCharCode(0) + 'x'],
  ]) {
    it(`rejects ${label} in a value`, () => {
      assert.ok('GATE_ID' in validate({ GATE_ID: value }));
    });
  }

  it('reports only the offending field when a value carries an injection', () => {
    assert.deepEqual(Object.keys(validate({ GATE_ID: 'G1\nADAPTER=evil' })), [
      'GATE_ID',
    ]);
  });

  for (const [label, key, value] of [
    ['a port above range', 'MQTT_PORT', '70000'],
    ['a non-numeric port', 'MQTT_PORT', 'abc'],
    ['an unknown adapter', 'ADAPTER', 'mylaps'],
    ['a gate id with a space', 'GATE_ID', 'CLUB START'],
    [
      'a heartbeat slower than the offline threshold',
      'HEARTBEAT_INTERVAL_MS',
      '60000',
    ],
    [
      'a simulate interval that would flood the broker',
      'SIMULATE_INTERVAL_MS',
      '1',
    ],
    ['transponders with a letter', 'TRANSPONDERS', '123,abc'],
  ]) {
    it(`rejects ${label}`, () => {
      assert.ok(key in validate({ [key]: value }));
    });
  }

  it('treats an absent or empty field as "leave unset", not invalid', () => {
    assert.deepEqual(validate({ SIMULATE_INTERVAL_MS: '' }), {});
    assert.deepEqual(validate({}), {});
  });
});

describe('readSettings', () => {
  it('fills every unset field with its default', () => {
    const { settings, invalid } = readSettings({ GATE_ID: 'CLUB_START_WP1' });
    assert.deepEqual(invalid, []);
    assert.equal(settings.GATE_ID, 'CLUB_START_WP1');
    assert.equal(settings.BEAM_LOCKOUT_MS, '500');
    assert.equal(settings.BUZZER_STATUS, 'on');
    assert.equal(settings.BUZZER_GPIO, undefined);
  });

  // Hand-edited gate.env never passed through the page's validation.
  it('names a field that breaks its rule and never hands its value on', () => {
    const { settings, invalid } = readSettings({
      BEAM_LOCKOUT_MS: '5OO',
      ADAPTER: 'mylaps',
    });
    assert.deepEqual(invalid.sort(), ['ADAPTER', 'BEAM_LOCKOUT_MS']);
    assert.equal(settings.BEAM_LOCKOUT_MS, '500');
    assert.equal(settings.ADAPTER, 'simulated');
  });

  it('ignores the rest of the environment', () => {
    assert.deepEqual(readSettings({ PATH: '/usr/bin' }).invalid, []);
  });

  it('has defaults that pass their own rules', () => {
    const defaults = Object.fromEntries(
      Object.entries(FIELDS).flatMap(([name, spec]) =>
        'default' in spec ? [[name, spec.default]] : [],
      ),
    );
    assert.deepEqual(validate(defaults), {});
  });
});

describe('writeConfig', () => {
  it('writes a file readConfig can read back', () => {
    const path = scratchFile();
    writeConfig({ GATE_ID: 'G1', MQTT_HOST: 'rally-server.local' }, path);
    assert.deepEqual(readConfig(path), {
      GATE_ID: 'G1',
      MQTT_HOST: 'rally-server.local',
    });
  });

  it('replaces the previous contents rather than appending', () => {
    const path = scratchFile();
    writeConfig({ GATE_ID: 'OLD', MQTT_PORT: '57431' }, path);
    writeConfig({ GATE_ID: 'NEW' }, path);
    const text = readFileSync(path, 'utf8');
    assert.ok(text.includes('GATE_ID=NEW'));
    assert.ok(!text.includes('OLD'));
    assert.ok(!text.includes('MQTT_PORT'));
  });

  it('leaves no temporary file behind', () => {
    const path = scratchFile();
    writeConfig({ GATE_ID: 'G1' }, path);
    assert.deepEqual(readdirSync(join(path, '..')), ['gate.env']);
  });

  it('reports a missing file as empty config, not a crash', () => {
    assert.deepEqual(
      readConfig(join(mkdtempSync(join(tmpdir(), 'gc-')), 'absent.env')),
      {},
    );
  });

  it('keeps the old file and cleans up when the write cannot land', () => {
    const path = scratchFile();
    const directory = join(path, '..');
    writeConfig({ GATE_ID: 'GOOD' }, path);
    // A path under a non-existent directory makes the temp write fail.
    assert.throws(() =>
      writeConfig({ GATE_ID: 'NEW' }, join(directory, 'missing', 'gate.env')),
    );
    assert.deepEqual(readConfig(path), { GATE_ID: 'GOOD' });
    assert.deepEqual(
      readdirSync(directory).filter((f) => f.endsWith('.tmp')),
      [],
    );
  });
});

/**
 * The point of these: field rules now exist twice at runtime — once in
 * `validate` on the server, once rebuilt from `fieldDescriptors()` in the
 * browser. Two implementations of one rule drift, and the failure is quiet: a
 * marshal either gets blocked by a rule the server does not have, or is told a
 * value is fine and then rejected on save. So the two paths are asserted to
 * agree rather than merely both existing.
 */
function clientSideRejects(field: FieldName, value: string): boolean {
  const spec = fieldDescriptors()[field];
  if (value === '') {
    return false;
  }
  if (spec.pattern && !new RegExp(spec.pattern).test(value)) {
    return true;
  }
  if (spec.oneOf && !spec.oneOf.includes(value)) {
    return true;
  }
  if (spec.range) {
    const parsed = Number(value);
    const [min, max] = spec.range;
    if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
      return true;
    }
  }
  return false;
}

describe('fieldDescriptors', () => {
  it('describes every settable field', () => {
    assert.deepEqual(Object.keys(fieldDescriptors()), Object.keys(FIELDS));
  });

  it('sends yes/no settings as toggles, validated as on/off', () => {
    const descriptors = fieldDescriptors();
    assert.equal(descriptors.BUZZER_STATUS.default, 'on');
    assert.equal(descriptors.FORWARD_BEAM_ONLY.default, 'off');
    for (const d of Object.values(descriptors).filter((d) => d.toggle)) {
      assert.deepEqual(d.oneOf, ['on', 'off']);
    }
  });

  it('survives JSON, which is how it reaches the browser', () => {
    const descriptors = fieldDescriptors();
    assert.equal(
      JSON.parse(JSON.stringify(descriptors)).GATE_ID.pattern,
      descriptors.GATE_ID.pattern,
    );
  });

  it('carries a rule for each field, so none silently validates client-side as anything', () => {
    for (const [name, spec] of Object.entries(fieldDescriptors())) {
      assert.deepEqual(
        { name, hasRule: !!(spec.pattern || spec.oneOf || spec.range) },
        { name, hasRule: true },
      );
    }
  });

  for (const [field, value, shouldPass] of [
    ['GATE_ID', 'CLUB_START_WP1', true],
    ['GATE_ID', 'CLUB START', false],
    ['GATE_ID', 'club_start_wp1', false],
    ['GATE_ID', 'A'.repeat(33), false],
    ['MQTT_HOST', 'rally-server.local', true],
    ['MQTT_HOST', '192.168.1.10', true],
    ['MQTT_HOST', 'fe80::1', true],
    ['MQTT_HOST', 'has space', false],
    ['MQTT_PORT', '57431', true],
    ['MQTT_PORT', '0', false],
    ['MQTT_PORT', '70000', false],
    ['MQTT_PORT', '574.31', false],
    ['ADAPTER', 'simulated', true],
    ['ADAPTER', 'openstint', true],
    ['ADAPTER', 'beam-openstint', true],
    ['ADAPTER', 'mylaps', false],
    ['TRANSPONDERS', '1234567', true],
    ['TRANSPONDERS', '1234567,7654321', true],
    ['TRANSPONDERS', '1234567,', false],
    ['TRANSPONDERS', '123,abc', false],
    ['SIMULATE_INTERVAL_MS', '8000', true],
    ['SIMULATE_INTERVAL_MS', '1', false],
    ['HEARTBEAT_INTERVAL_MS', '15000', true],
    ['HEARTBEAT_INTERVAL_MS', '60000', false],
  ] as [FieldName, string, boolean][]) {
    it(`agrees between server and client for ${field} = ${value}`, () => {
      const serverAccepts = validate({ [field]: value })[field] === undefined;
      assert.deepEqual(
        { server: serverAccepts, client: !clientSideRejects(field, value) },
        { server: shouldPass, client: shouldPass },
      );
    });
  }

  it("reports a broken rule as 'invalid', which the page words as the field's message", () => {
    assert.equal(validate({ MQTT_PORT: '70000' }).MQTT_PORT, 'invalid');
  });
});

describe('field groups', () => {
  // The page renders one card per group and nothing outside them, so a field
  // carrying a group the component does not know about is simply invisible —
  // a setting a marshal cannot reach, with no error anywhere to say so.
  const RENDERED_GROUPS: string[] = ['general', 'decoder'];

  it('puts every field in a group the page renders', () => {
    const stranded = Object.entries(fieldDescriptors())
      .filter(([, descriptor]) => !RENDERED_GROUPS.includes(descriptor.group))
      .map(([name]) => name);
    assert.deepEqual(stranded, []);
  });

  it('ties decoder settings only to decoders that exist', () => {
    // A field whose adapter can never be selected would never be shown.
    const descriptors = fieldDescriptors();
    const orphaned = Object.entries(descriptors)
      .filter(([, d]) =>
        d.adapters?.some((a) => !descriptors.ADAPTER.oneOf!.includes(a)),
      )
      .map(([name]) => name);
    assert.deepEqual(orphaned, []);
    assert.ok(descriptors.BEAM_GPIO.adapters?.includes('beam'));
    assert.deepEqual(descriptors.TRANSPONDERS.adapters, ['simulated']);
  });

  it('keeps the simulator settings with the decoder', () => {
    const descriptors = fieldDescriptors();
    assert.equal(descriptors.ADAPTER.group, 'decoder');
    assert.equal(descriptors.TRANSPONDERS.group, 'decoder');
    assert.equal(descriptors.SIMULATE_INTERVAL_MS.group, 'decoder');
    assert.equal(descriptors.GATE_ID.group, 'general');
  });
});

// The server sends rules only, so a new field without its words on the page
// would show its raw key as label.
describe('field texts', () => {
  for (const locale of ['en', 'de']) {
    it(`has a label, hint and message for every field in ${locale}`, () => {
      const messages = JSON.parse(
        readFileSync(
          join(__dirname, '..', 'web', 'src', 'locales', `${locale}.json`),
          'utf8',
        ),
      );
      const missing = Object.keys(FIELDS).flatMap((name) =>
        ['label', 'hint', 'message']
          .filter((part) => typeof messages.fields?.[name]?.[part] !== 'string')
          .map((part) => `${name}.${part}`),
      );
      assert.deepEqual(missing, []);
    });
  }
});

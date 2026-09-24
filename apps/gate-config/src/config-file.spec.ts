import { mkdtempSync, readFileSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  FIELDS,
  FieldName,
  fieldDescriptors,
  parseEnvFile,
  readConfig,
  serializeEnvFile,
  validate,
  writeConfig,
} from './config-file';

function scratchFile(): string {
  return join(mkdtempSync(join(tmpdir(), 'gate-config-')), 'gate.env');
}

describe('parseEnvFile', () => {
  it('reads keys, ignoring comments and blank lines', () => {
    expect(
      parseEnvFile('# a comment\n\nGATE_ID=CLUB_START_WP1\nMQTT_PORT=57431\n'),
    ).toEqual({ GATE_ID: 'CLUB_START_WP1', MQTT_PORT: '57431' });
  });

  it('drops keys that are not settable, so a hand-edited file cannot smuggle them back', () => {
    expect(parseEnvFile('GATE_ID=G1\nLD_PRELOAD=/tmp/evil.so\n')).toEqual({
      GATE_ID: 'G1',
    });
  });

  it('round-trips through serialize', () => {
    const config = { GATE_ID: 'G1', MQTT_HOST: 'rally-server.local' };
    expect(parseEnvFile(serializeEnvFile(config))).toEqual(config);
  });

  it('omits empty values rather than writing a blank assignment', () => {
    expect(serializeEnvFile({ GATE_ID: 'G1', TRANSPONDERS: '' })).not.toContain(
      'TRANSPONDERS',
    );
  });
});

describe('validate', () => {
  it('accepts a realistic configuration', () => {
    expect(
      validate({
        GATE_ID: 'CLUB_START_WP1',
        MQTT_HOST: 'rally-server.local',
        MQTT_PORT: '57431',
        ADAPTER: 'simulated',
        TRANSPONDERS: '1234567,7654321',
        HEARTBEAT_INTERVAL_MS: '15000',
      }),
    ).toEqual({});
  });

  it('rejects an unknown key instead of ignoring it', () => {
    expect(validate({ NODE_OPTIONS: '--require /tmp/x.js' })).toHaveProperty(
      'NODE_OPTIONS',
    );
  });

  // The one that matters most: a line break would append a second KEY=value
  // line to the file systemd reads as EnvironmentFile, which makes every
  // per-field rule below it bypassable and runs code as the gate-agent user.
  it.each([
    ['a line feed', 'G1\nLD_PRELOAD=/tmp/evil.so'],
    ['a carriage return', 'G1\rLD_PRELOAD=/tmp/evil.so'],
    // Built rather than written as a '\u0000' escape: prettier rewrites that
    // into a raw NUL byte in the source, which is invisible in a diff and
    // does not survive every editor.
    ['a null byte', 'G1' + String.fromCharCode(0) + 'x'],
  ])('rejects %s in a value', (_label, value) => {
    expect(validate({ GATE_ID: value })).toHaveProperty('GATE_ID');
  });

  it('reports only the offending field when a value carries an injection', () => {
    expect(Object.keys(validate({ GATE_ID: 'G1\nADAPTER=evil' }))).toEqual([
      'GATE_ID',
    ]);
  });

  it.each([
    ['a port above range', 'MQTT_PORT', '70000'],
    ['a non-numeric port', 'MQTT_PORT', 'abc'],
    ['an unknown adapter', 'ADAPTER', 'openstint'],
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
  ])('rejects %s', (_label, key, value) => {
    expect(validate({ [key]: value })).toHaveProperty(key);
  });

  it('treats an absent or empty field as "leave unset", not invalid', () => {
    expect(validate({ SIMULATE_INTERVAL_MS: '' })).toEqual({});
    expect(validate({})).toEqual({});
  });
});

describe('writeConfig', () => {
  it('writes a file readConfig can read back', () => {
    const path = scratchFile();
    writeConfig({ GATE_ID: 'G1', MQTT_HOST: 'rally-server.local' }, path);
    expect(readConfig(path)).toEqual({
      GATE_ID: 'G1',
      MQTT_HOST: 'rally-server.local',
    });
  });

  it('replaces the previous contents rather than appending', () => {
    const path = scratchFile();
    writeConfig({ GATE_ID: 'OLD', MQTT_PORT: '57431' }, path);
    writeConfig({ GATE_ID: 'NEW' }, path);
    const text = readFileSync(path, 'utf8');
    expect(text).toContain('GATE_ID=NEW');
    expect(text).not.toContain('OLD');
    expect(text).not.toContain('MQTT_PORT');
  });

  it('leaves no temporary file behind', () => {
    const path = scratchFile();
    writeConfig({ GATE_ID: 'G1' }, path);
    expect(readdirSync(join(path, '..'))).toEqual(['gate.env']);
  });

  it('reports a missing file as empty config, not a crash', () => {
    expect(
      readConfig(join(mkdtempSync(join(tmpdir(), 'gc-')), 'absent.env')),
    ).toEqual({});
  });

  it('keeps the old file and cleans up when the write cannot land', () => {
    const path = scratchFile();
    const directory = join(path, '..');
    writeConfig({ GATE_ID: 'GOOD' }, path);
    // A path under a non-existent directory makes the temp write fail.
    expect(() =>
      writeConfig({ GATE_ID: 'NEW' }, join(directory, 'missing', 'gate.env')),
    ).toThrow();
    expect(readConfig(path)).toEqual({ GATE_ID: 'GOOD' });
    expect(readdirSync(directory).filter((f) => f.endsWith('.tmp'))).toEqual(
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
    expect(Object.keys(fieldDescriptors())).toEqual(Object.keys(FIELDS));
  });

  it('survives JSON, which is how it reaches the browser', () => {
    const descriptors = fieldDescriptors();
    expect(JSON.parse(JSON.stringify(descriptors)).GATE_ID.pattern).toBe(
      descriptors.GATE_ID.pattern,
    );
  });

  it('carries a rule for each field, so none silently validates client-side as anything', () => {
    for (const [name, spec] of Object.entries(fieldDescriptors())) {
      expect({
        name,
        hasRule: !!(spec.pattern || spec.oneOf || spec.range),
      }).toEqual({ name, hasRule: true });
    }
  });

  it.each([
    ['GATE_ID', 'CLUB_START_WP1', true],
    ['GATE_ID', 'CLUB START', false],
    ['GATE_ID', 'a'.repeat(65), false],
    ['MQTT_HOST', 'rally-server.local', true],
    ['MQTT_HOST', '192.168.1.10', true],
    ['MQTT_HOST', 'fe80::1', true],
    ['MQTT_HOST', 'has space', false],
    ['MQTT_PORT', '57431', true],
    ['MQTT_PORT', '0', false],
    ['MQTT_PORT', '70000', false],
    ['MQTT_PORT', '574.31', false],
    ['ADAPTER', 'simulated', true],
    ['ADAPTER', 'openstint', false],
    ['TRANSPONDERS', '1234567', true],
    ['TRANSPONDERS', '1234567,7654321', true],
    ['TRANSPONDERS', '1234567,', false],
    ['TRANSPONDERS', '123,abc', false],
    ['SIMULATE_INTERVAL_MS', '8000', true],
    ['SIMULATE_INTERVAL_MS', '1', false],
    ['HEARTBEAT_INTERVAL_MS', '15000', true],
    ['HEARTBEAT_INTERVAL_MS', '60000', false],
  ] as [FieldName, string, boolean][])(
    'agrees between server and client for %s = %s',
    (field, value, shouldPass) => {
      const serverAccepts = validate({ [field]: value })[field] === undefined;
      expect({
        server: serverAccepts,
        client: !clientSideRejects(field, value),
      }).toEqual({ server: shouldPass, client: shouldPass });
    },
  );

  it('shows the same message from both sides', () => {
    expect(validate({ MQTT_PORT: '70000' }).MQTT_PORT).toBe(
      fieldDescriptors().MQTT_PORT.message,
    );
  });
});

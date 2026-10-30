import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { gatePassword, loadGateKey } from './gate-key';

test('creates the key once and keeps it', () => {
  const path = join(
    mkdtempSync(join(tmpdir(), 'gate-key-')),
    'sub',
    'gate.key',
  );
  const key = loadGateKey(path);
  assert.match(key, /^[0-9a-f]{64}$/);
  assert.equal(loadGateKey(path), key);
});

test('builds the token the server checks', () => {
  // Same vector as the ESP32 firmware's test: key 32 × 0xaa, gate G1.
  assert.equal(
    gatePassword('aa'.repeat(32), 'G1', false, 1_800_000_000_000),
    '1800000060000.4231b15975d7e3739ed595c7308c5cb7aee07c44536aa735be18c701e45de59a',
  );
  assert.equal(
    gatePassword('ab'.repeat(32), 'G1', true),
    `key:${'ab'.repeat(32)}`,
  );
});

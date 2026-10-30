import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { newSession, validPass, validSession } from './access';

const KEY = 'aa'.repeat(32);
const NOW = 1_800_000_000_000;
// Same vector as gate-pairing.service.spec.ts and the ESP32 firmware's test.
const PASS =
  '1800000060000.cec4c7c97d5c4899e5ebc6b33e679d2bbb5e6a4eb34632478ad54024ecedd02b';

describe('validPass', () => {
  it('accepts the server-signed pass until it expires', () => {
    assert.equal(validPass(KEY, 'G1', PASS, NOW), true);
    assert.equal(validPass(KEY, 'G1', PASS, NOW + 69_000), true);
    assert.equal(validPass(KEY, 'G1', PASS, NOW + 71_000), false);
  });

  it('refuses another gate, another key, a broker token and garbage', () => {
    assert.equal(validPass(KEY, 'G2', PASS, NOW), false);
    assert.equal(validPass('bb'.repeat(32), 'G1', PASS, NOW), false);
    const brokerToken =
      '1800000060000.4231b15975d7e3739ed595c7308c5cb7aee07c44536aa735be18c701e45de59a';
    assert.equal(validPass(KEY, 'G1', brokerToken, NOW), false);
    assert.equal(validPass(KEY, 'G1', '', NOW), false);
    assert.equal(validPass(KEY, 'G1', 'x.y', NOW), false);
  });

  it('refuses a pass that reaches too far ahead', () => {
    // Valid 60 s plus 10 s slack, so seen 11 s before it was signed it is too far.
    assert.equal(validPass(KEY, 'G1', PASS, NOW - 11_000), false);
  });
});

describe('sessions', () => {
  it('last an hour and need the key', () => {
    const session = newSession(KEY, NOW);
    assert.equal(validSession(KEY, session, NOW + 59 * 60_000), true);
    assert.equal(validSession(KEY, session, NOW + 61 * 60_000), false);
    assert.equal(validSession('bb'.repeat(32), session, NOW), false);
  });

  it('are not a pass, nor a pass a session', () => {
    assert.equal(validSession(KEY, PASS, NOW), false);
    assert.equal(validPass(KEY, 'G1', newSession(KEY, NOW), NOW), false);
  });
});

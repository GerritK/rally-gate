import {
  BUZZER_GAP_MS,
  BUZZER_LONG_MS,
  BUZZER_SIGNAL_GAP_MS,
  BUZZER_SIGNALS,
} from '@rally-gate/shared';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

test('every signal holds a long tone, so a queue of passings cannot sound like one', () => {
  for (const [name, tones] of Object.entries(BUZZER_SIGNALS)) {
    assert.ok(tones.includes(BUZZER_LONG_MS), name);
  }
});

test('no two signals sound alike', () => {
  const patterns = Object.values(BUZZER_SIGNALS).map((t) => t.join(','));
  assert.equal(new Set(patterns).size, patterns.length);
});

// The firmware cannot import shared, so it carries a copy; this is what keeps it honest.
test('the ESP32 firmware has the same signals', () => {
  const header = readFileSync(
    join(__dirname, '../../../../firmware/esp32-gate/src/buzzer_signals.h'),
    'utf8',
  );
  const copy = Object.fromEntries(
    [...header.matchAll(/(\w+)\[\] = \{([^}]*)\}/g)].map(([, name, tones]) => [
      name,
      tones.split(',').map(Number),
    ]),
  );
  assert.deepEqual(copy, BUZZER_SIGNALS);
  assert.match(header, new RegExp(` BUZZER_GAP_MS = ${BUZZER_GAP_MS};`));
  assert.match(
    header,
    new RegExp(`BUZZER_SIGNAL_GAP_MS = ${BUZZER_SIGNAL_GAP_MS};`),
  );
});

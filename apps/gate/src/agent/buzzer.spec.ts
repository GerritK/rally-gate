import assert from 'node:assert/strict';
import { test } from 'node:test';
import { beepCommands, Buzzer } from './buzzer';

test('libgpiod v1 beeps, then sets the line low', () => {
  assert.deepEqual(beepCommands(['gpiochip0', '27'], 'GPIO27', 120), [
    ['gpioset', ['--mode=time', '--usec=120000', 'gpiochip0', '27=1']],
    ['gpioset', ['gpiochip0', '27=0']],
  ]);
});

test('libgpiod v2 toggles low after the beep and exits', () => {
  assert.deepEqual(beepCommands(null, 'GPIO27', 120), [
    ['gpioset', ['-t', '120ms,0', 'GPIO27=1']],
  ]);
});

test('a second of silence before a signal, none between passings', async () => {
  const buzzer = new Buzzer('GPIO_NONE');
  // No gpiod here: silent tones, only the queue's timing is left.
  (buzzer as unknown as { tone: () => [] }).tone = () => [];
  const start = Date.now();
  buzzer.beep();
  buzzer.beep();
  await buzzer.play('powerOn');
  // Three tone gaps plus one signal gap; a gap between the passings would add 900.
  const elapsed = Date.now() - start;
  assert.ok(elapsed >= 1150 && elapsed < 1700, `${elapsed} ms`);
});

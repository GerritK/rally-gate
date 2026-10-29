import assert from 'node:assert/strict';
import { test } from 'node:test';
import { beepCommands } from './buzzer';

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

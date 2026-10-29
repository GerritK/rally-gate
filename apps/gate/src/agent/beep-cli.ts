import './load-env';
import { isBuzzerSignal } from '@rally-gate/shared';
import { Buzzer } from './buzzer';
import { config } from './config';

// One signal from outside the agent (`rally-gate-beep hotspot`): the hotspot
// watchdog and gate-config's power-off are other processes.
const signal = process.argv[2] ?? '';
if (!isBuzzerSignal(signal)) {
  console.error('usage: beep-cli <signal>');
  process.exit(64);
}
if (!config.buzzerLine) {
  process.exit(0);
}
void new Buzzer(config.buzzerLine, config.buzzerStatus)
  .play(signal)
  .then(() => process.exit(0));

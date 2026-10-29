// Side-effect import, first in beep-cli: the hotspot watchdog and gate-config
// don't run with gate.env as their environment, the agent unit does.
import { CONFIG_PATH } from '../paths';

try {
  process.loadEnvFile(CONFIG_PATH);
} catch {
  // No file: the defaults apply, as for the agent.
}

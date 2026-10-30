import { dirname, join } from 'path';

/** `gate.env`: written by gate-config, the agent unit's `EnvironmentFile=`. */
export const CONFIG_PATH =
  process.env.GATE_CONFIG_FILE ?? '/etc/rally-gate/gate.env';

/**
 * The agent's systemd `RuntimeDirectory=`, which gate-config reads. Off a Pi
 * systemd gives the agent none, so the agent writes nothing there.
 */
const AGENT_RUNTIME_DIR =
  process.env.RUNTIME_DIRECTORY ?? '/run/rally-gate-agent';

/** OpenStint's latest status line. */
export const DECODER_STATUS_FILE =
  process.env.OPENSTINT_STATUS_FILE ??
  join(AGENT_RUNTIME_DIR, 'openstint-status');

/**
 * Created once the broker accepted the agent's login; it ends gate-config's
 * power-on window (`docs/auth.md` "gate-config").
 */
export const SERVER_REACHED_FILE = join(AGENT_RUNTIME_DIR, 'server-reached');

/**
 * The gate's own key, created by the agent on its first start
 * (`docs/auth.md` "Gates"). Its own file because the installer rewrites
 * gate.env on every update; a new key is a new identity that needs approval.
 */
export const GATE_KEY_PATH =
  process.env.GATE_KEY_FILE ?? join(dirname(CONFIG_PATH), 'gate.key');

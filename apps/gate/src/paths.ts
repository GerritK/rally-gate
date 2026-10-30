import { dirname, join } from 'path';

/** `gate.env`: written by gate-config, the agent unit's `EnvironmentFile=`. */
export const CONFIG_PATH =
  process.env.GATE_CONFIG_FILE ?? '/etc/rally-gate/gate.env';

/**
 * OpenStint's latest status line, written by the agent into its systemd
 * `RuntimeDirectory=` and read by gate-config. Unset off a Pi, where systemd
 * gives the agent no runtime directory and nothing reads it.
 */
export const DECODER_STATUS_FILE =
  process.env.OPENSTINT_STATUS_FILE ??
  (process.env.RUNTIME_DIRECTORY
    ? join(process.env.RUNTIME_DIRECTORY, 'openstint-status')
    : '/run/rally-gate-agent/openstint-status');

/**
 * The gate's own key, created by the agent on its first start
 * (`docs/auth.md` "Gates"). Its own file because the installer rewrites
 * gate.env on every update; a new key is a new identity that needs approval.
 */
export const GATE_KEY_PATH =
  process.env.GATE_KEY_FILE ?? join(dirname(CONFIG_PATH), 'gate.key');

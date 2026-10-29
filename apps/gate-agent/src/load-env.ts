// Side-effect import, first in beep-cli: the hotspot watchdog and gate-config
// don't run with gate.env as their environment, the agent unit does.
try {
  process.loadEnvFile(
    process.env.GATE_CONFIG_FILE ?? '/etc/rally-gate/gate.env',
  );
} catch {
  // No file: the defaults apply, as for the agent.
}

/**
 * Payload of `rally/gates/<gateId>/heartbeat`.
 *
 * Every field is optional so a gate running an older build still registers
 * and still counts as alive — a heartbeat's primary job is liveness, and
 * losing clock-offset measurement is not a reason to drop it.
 */
export interface GateHeartbeat {
  /** What decoder the gate reports running, mirrored onto `Gate.capabilities`. */
  capabilities?: string;

  /**
   * The gate's own clock at the moment it published this heartbeat. The
   * server compares it against arrival time to estimate how far that gate's
   * clock is from its own — see "Clock offset" in docs/architecture.md.
   * Deliberately sampled at publish time, not at connect time, so it
   * measures the clock as it is now rather than as it was at boot.
   */
  sentAt?: string;

  /** The gate's build (`VERSION`), mirrored onto `Gate.version`. */
  version?: string;

  /**
   * chrony's own view, from `chronyc tracking`: whether it is synchronised,
   * and how far it estimates the gate's clock is from its source (absolute,
   * ms). Unlike `sentAt` this is a round-trip measurement, so it resolves
   * below network latency. Both absent when chrony can't be read.
   */
  chronySynced?: boolean;
  chronyOffsetMs?: number;
}

/** Past this without a heartbeat (sent every 15s), a gate counts as offline. */
export const HEARTBEAT_ONLINE_THRESHOLD_MS = 30_000;

/** gate-config's fixed port on every gate — see the port table in CLAUDE.md. */
export const GATE_CONFIG_PORT = 57439;

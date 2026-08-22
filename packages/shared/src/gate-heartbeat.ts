/**
 * Payload of `rally/gates/<gateId>/heartbeat`.
 *
 * Both fields are optional so a gate running an older build still registers
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
}

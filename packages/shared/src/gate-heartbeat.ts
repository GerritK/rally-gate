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
   * The gate's NTP sync: whether it is synchronised, and the RMS of its
   * recent measured offsets (ms) — chrony's "RMS offset" on a Pi, the same
   * figure computed by the ESP32 firmware. Unlike `sentAt` these are
   * round-trip measurements, so they resolve below network latency. Both
   * absent when the gate can't report them.
   */
  ntpSynced?: boolean;
  ntpOffsetMs?: number;
}

/**
 * A gate's NTP accuracy (`ntpOffsetMs`) past which it shows amber, on the
 * dashboard and on the gate's own page. Measured ESP32 and Pi gates sit
 * around 0.5–2ms on rally Wi-Fi. The ESP32 page has its own copy of this
 * number, since nothing compiles shared into the firmware.
 */
export const NTP_OFFSET_WARN_THRESHOLD_MS = 5;

/** Past this without a heartbeat (sent every 15s), a gate counts as offline. */
export const HEARTBEAT_ONLINE_THRESHOLD_MS = 30_000;

/** gate-config's fixed port on every gate — see the port table in CLAUDE.md. */
export const GATE_CONFIG_PORT = 57439;

/** A gate's config page, from the address its MQTT connection came from.
 *  An IPv6 literal needs brackets in a URL. */
export function gateConfigUrl(address: string): string {
  const host = address.includes(':') ? `[${address}]` : address;
  return `http://${host}:${GATE_CONFIG_PORT}/`;
}

/**
 * One gate's answer to "shut down". `unreachable`: no reply from its
 * gate-config; `refused`: it replied but the shutdown didn't start, with the
 * command's own output as `detail`.
 */
export interface GatePowerOffResult {
  gateId: string;
  ok: boolean;
  error?: 'unreachable' | 'refused';
  detail?: string;
}

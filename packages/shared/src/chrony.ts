/** A Pi gate's clock sync as chrony reports it: gate-agent's heartbeat and
 *  gate-config's status read the same thing. */
export interface ChronyState {
  ntpSynced: boolean;
  ntpOffsetMs: number;
}

/**
 * `chronyc -c tracking` is one CSV line: field 6 is the RMS offset in seconds,
 * the last field the leap status. RMS rather than field 4 (system time): that
 * one is the distance to chrony's own filtered estimate, near zero once
 * slewed, and not comparable with what an ESP32 gate reports. The offset's sign is taken as
 * absolute — which way the clock is off doesn't change whether it's usable.
 */
export function parseTracking(csv: string): ChronyState | undefined {
  const fields = csv.trim().split(',');
  const offsetS = Number(fields[6]);
  if (fields.length < 14 || Number.isNaN(offsetS)) {
    return undefined;
  }
  return {
    ntpSynced: fields[fields.length - 1] !== 'Not synchronised',
    ntpOffsetMs: Math.abs(offsetS) * 1000,
  };
}

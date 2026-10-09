import { readFileSync, statSync } from 'fs';
import type { DecoderStatus } from './api-types';

/** Written by gate-agent's OpenStint adapter into its systemd RuntimeDirectory. */
const STATUS_FILE =
  process.env.OPENSTINT_STATUS_FILE ?? '/run/rally-gate-agent/openstint-status';

/**
 * OpenStint's `S <timestamp> <noise_power> <dc_offset> <frames_received>
 * <frames_processed> [jitter_p95_ms …]`, per upstream's decoder protocol.
 * Older releases end after frames_processed, newer may append more fields.
 */
export function parseStatusLine(
  line: string,
): Omit<DecoderStatus, 'ageMs'> | null {
  const parts = line.trim().split(/\s+/);
  if (parts[0] !== 'S' || parts.length < 6) return null;
  const [noisePower, dcOffset, framesReceived, framesProcessed] = parts
    .slice(2, 6)
    .map(Number);
  if (
    ![noisePower, dcOffset, framesReceived, framesProcessed].every(
      Number.isFinite,
    )
  ) {
    return null;
  }
  return { noisePower, dcOffset, framesReceived, framesProcessed };
}

/** null when no OpenStint decoder runs: another adapter, or the agent is down. */
export function readDecoderStatus(): DecoderStatus | null {
  try {
    const parsed = parseStatusLine(readFileSync(STATUS_FILE, 'utf8'));
    if (!parsed) return null;
    return { ...parsed, ageMs: Date.now() - statSync(STATUS_FILE).mtimeMs };
  } catch {
    return null;
  }
}

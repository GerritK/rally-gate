export const DETECTION_TOPIC_PREFIX = 'rally/gates';

export function detectionTopicFor(gateId: string): string {
  return `${DETECTION_TOPIC_PREFIX}/${gateId}/detections`;
}

export function heartbeatTopicFor(gateId: string): string {
  return `${DETECTION_TOPIC_PREFIX}/${gateId}/heartbeat`;
}

/**
 * What a gate id may be, on every kind of gate and on the server. It is a
 * topic segment, the Pi derives its host name from it, and it goes on a
 * sticker — capitals only, so `start_wp1` and `START_WP1` can't be two gates.
 * Inputs turn typed letters into capitals; nothing else normalises. The ESP32
 * firmware mirrors this in `gate::validGateId`.
 */
export const GATE_ID_PATTERN = /^[A-Z0-9_]{1,32}$/;

/**
 * A gate logs in to the broker with its gate id as username (and client id)
 * and, as password, `<expiryMs>.<hex HMAC-SHA256(key, gateId + "." +
 * expiryMs)>`, the expiry about a minute ahead. Only when the broker answers
 * CONNACK 4 (bad username or password), which it does while pairing is open,
 * does the gate send this prefix plus its key (64 hex) on the next try.
 * The ESP32 firmware builds the same strings (`docs/auth.md` "Gates").
 */
export const GATE_KEY_PASSWORD_PREFIX = 'key:';

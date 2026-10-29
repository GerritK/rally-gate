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

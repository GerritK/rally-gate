export const DETECTION_TOPIC_PREFIX = 'rally/gates';

export function detectionTopicFor(gateId: string): string {
  return `${DETECTION_TOPIC_PREFIX}/${gateId}/detections`;
}

export const DETECTION_TOPIC_WILDCARD = `${DETECTION_TOPIC_PREFIX}/+/detections`;

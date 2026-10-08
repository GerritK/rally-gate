export const DETECTION_TOPIC_PREFIX = 'rally/gates';

export function detectionTopicFor(gateId: string): string {
  return `${DETECTION_TOPIC_PREFIX}/${gateId}/detections`;
}

export function heartbeatTopicFor(gateId: string): string {
  return `${DETECTION_TOPIC_PREFIX}/${gateId}/heartbeat`;
}

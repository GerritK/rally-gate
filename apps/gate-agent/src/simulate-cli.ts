import { detectionTopicFor, DetectionEvent } from '@rally-gate/shared';
import mqtt from 'mqtt';
import { ulid } from 'ulid';

function arg(name: string, fallback?: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 ? process.argv[idx + 1] : fallback;
}

const gateId = arg('gate', process.env.GATE_ID ?? 'START_WP1')!;
// --beam publishes a passing without a transponder, like a light barrier.
const transponderId = process.argv.includes('--beam')
  ? undefined
  : arg('transponder', '1234567')!;
const host = process.env.MQTT_HOST ?? 'localhost';
const port = process.env.MQTT_PORT ?? '57431';

const client = mqtt.connect(`mqtt://${host}:${port}`);

client.on('connect', () => {
  const event: DetectionEvent = {
    eventId: ulid(),
    gateId,
    transponderId,
    timestampGate: new Date().toISOString(),
    source: 'simulated-cli',
  };
  // QoS 1 so the callback fires on PUBACK rather than on local write —
  // otherwise this one-shot CLI can `client.end()` before the broker has the
  // detection, and report success for a publish that never landed.
  client.publish(
    detectionTopicFor(gateId),
    JSON.stringify(event),
    { qos: 1 },
    () => {
      console.log(
        `Published detection: gate=${gateId} transponder=${transponderId ?? 'none'}`,
      );
      client.end();
    },
  );
});

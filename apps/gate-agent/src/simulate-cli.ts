import { detectionTopicFor, DetectionEvent } from '@rally-gate/shared';
import mqtt from 'mqtt';
import { ulid } from 'ulid';

function arg(name: string, fallback?: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 ? process.argv[idx + 1] : fallback;
}

const gateId = arg('gate', process.env.GATE_ID ?? 'START_WP1')!;
const transponderId = arg('transponder', '1234567')!;
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
  client.publish(detectionTopicFor(gateId), JSON.stringify(event), {}, () => {
    console.log(
      `Published detection: gate=${gateId} transponder=${transponderId}`,
    );
    client.end();
  });
});

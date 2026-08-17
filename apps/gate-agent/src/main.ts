import { detectionTopicFor, heartbeatTopicFor, DetectionEvent } from '@rally-gate/shared';
import mqtt from 'mqtt';
import { ulid } from 'ulid';
import { SimulatedAdapter } from './adapters/simulated.adapter';

const GATE_ID = process.env.GATE_ID ?? 'START_WP1';
const MQTT_HOST = process.env.MQTT_HOST ?? 'localhost';
const MQTT_PORT = process.env.MQTT_PORT ?? '57431';
const TRANSPONDERS = (process.env.TRANSPONDERS ?? '1234567').split(',').map((t) => t.trim());
const SIMULATE_INTERVAL_MS = process.env.SIMULATE_INTERVAL_MS ? Number(process.env.SIMULATE_INTERVAL_MS) : undefined;
const HEARTBEAT_INTERVAL_MS = Number(process.env.HEARTBEAT_INTERVAL_MS ?? 15000);
const CAPABILITIES = process.env.ADAPTER ?? 'simulated';

const client = mqtt.connect(`mqtt://${MQTT_HOST}:${MQTT_PORT}`);

function publishHeartbeat() {
  client.publish(heartbeatTopicFor(GATE_ID), JSON.stringify({ capabilities: CAPABILITIES }));
}

client.on('connect', () => {
  console.log(`[gate-agent:${GATE_ID}] connected to broker at ${MQTT_HOST}:${MQTT_PORT}`);
  publishHeartbeat();
});

const heartbeatTimer = setInterval(publishHeartbeat, HEARTBEAT_INTERVAL_MS);

client.on('error', (err) => {
  console.error(`[gate-agent:${GATE_ID}] mqtt error`, err);
});

function publishDetection(transponderId: string, timestamp: Date) {
  const event: DetectionEvent = {
    eventId: ulid(),
    gateId: GATE_ID,
    transponderId,
    timestampGate: timestamp.toISOString(),
    source: 'simulated',
  };
  client.publish(detectionTopicFor(GATE_ID), JSON.stringify(event));
  console.log(`[gate-agent:${GATE_ID}] published detection for transponder ${transponderId}`);
}

const adapter = new SimulatedAdapter({ transponderIds: TRANSPONDERS, intervalMs: SIMULATE_INTERVAL_MS });
adapter.start(publishDetection);

process.on('SIGINT', async () => {
  clearInterval(heartbeatTimer);
  await adapter.stop();
  client.end();
  process.exit(0);
});

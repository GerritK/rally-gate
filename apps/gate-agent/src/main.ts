import {
  detectionTopicFor,
  heartbeatTopicFor,
  DetectionEvent,
  GateHeartbeat,
} from '@rally-gate/shared';
import mqtt from 'mqtt';
import { ulid } from 'ulid';
import { SimulatedAdapter } from './adapters/simulated.adapter';

const GATE_ID = process.env.GATE_ID ?? 'START_WP1';
const MQTT_HOST = process.env.MQTT_HOST ?? 'localhost';
const MQTT_PORT = process.env.MQTT_PORT ?? '57431';
const TRANSPONDERS = (process.env.TRANSPONDERS ?? '1234567')
  .split(',')
  .map((t) => t.trim());
const SIMULATE_INTERVAL_MS = process.env.SIMULATE_INTERVAL_MS
  ? Number(process.env.SIMULATE_INTERVAL_MS)
  : undefined;
const HEARTBEAT_INTERVAL_MS = Number(
  process.env.HEARTBEAT_INTERVAL_MS ?? 15000,
);
const CAPABILITIES = process.env.ADAPTER ?? 'simulated';

/**
 * `clientId`/`clean` are load-bearing, not boilerplate. Detections are
 * published at QoS 1 (see `publishDetection`), and mqtt.js only replays
 * in-flight QoS>0 messages across a reconnect when the session is persistent
 * — with the default `clean: true` it discards its outgoing store instead,
 * so a drop mid-publish loses the detection silently.
 *
 * Using GATE_ID as the client id also makes a duplicated GATE_ID visible:
 * MQTT kicks the older connection when a second client claims the same id,
 * so the gates flap instead of quietly merging into one `Gate` row (see
 * "Gate discovery & heartbeat" in docs/architecture.md).
 *
 * `queueQoSZero: false` because mqtt.js otherwise buffers heartbeats while
 * offline and flushes them all on connect: each carries a stale `sentAt`, so
 * the server measures the outage as clock offset and corrects detections by it.
 */
const client = mqtt.connect(`mqtt://${MQTT_HOST}:${MQTT_PORT}`, {
  clientId: GATE_ID,
  clean: false,
  queueQoSZero: false,
});

function publishHeartbeat() {
  // Deliberately QoS 0: a heartbeat is a liveness ping that repeats every
  // HEARTBEAT_INTERVAL_MS, so a missed one is self-healing and queueing it
  // for redelivery would only report staleness as freshness.
  const heartbeat: GateHeartbeat = {
    capabilities: CAPABILITIES,
    // Stamped here rather than anywhere upstream: the server subtracts this
    // from arrival time to estimate this gate's clock offset, so it has to be
    // read as late as possible before the packet goes out.
    sentAt: new Date().toISOString(),
  };
  client.publish(heartbeatTopicFor(GATE_ID), JSON.stringify(heartbeat));
}

client.on('connect', () => {
  console.log(
    `[gate-agent:${GATE_ID}] connected to broker at ${MQTT_HOST}:${MQTT_PORT}`,
  );
  publishHeartbeat();
});

const heartbeatTimer = setInterval(publishHeartbeat, HEARTBEAT_INTERVAL_MS);

client.on('error', (err) => {
  // Message only: this repeats every reconnect, and the stack is always the same DNS/socket frames.
  console.error(`[gate-agent:${GATE_ID}] mqtt error: ${err.message}`);
});

function publishDetection(transponderId: string, timestamp: Date) {
  const event: DetectionEvent = {
    eventId: ulid(),
    gateId: GATE_ID,
    transponderId,
    timestampGate: timestamp.toISOString(),
    source: 'simulated',
  };
  // QoS 1: a lost detection is a driver with no time, and at-least-once is
  // safe because the server pipeline is idempotent — DetectionEventRecord is
  // keyed on the gate-generated `eventId`, and startRun/finishRun/recordSplit
  // all ignore repeats (stage-runs.service.ts).
  //
  // ponytail: in-memory retry only — a systemd restart still drops whatever
  // wasn't acked yet. Add a disk-backed mqtt.js outgoingStore if gates turn
  // out to lose detections across crashes in the field.
  client.publish(detectionTopicFor(GATE_ID), JSON.stringify(event), { qos: 1 });
  console.log(
    `[gate-agent:${GATE_ID}] published detection for transponder ${transponderId}`,
  );
}

const adapter = new SimulatedAdapter({
  transponderIds: TRANSPONDERS,
  intervalMs: SIMULATE_INTERVAL_MS,
});
adapter.start(publishDetection);

process.on('SIGINT', async () => {
  clearInterval(heartbeatTimer);
  await adapter.stop();
  client.end();
  process.exit(0);
});

import {
  detectionTopicFor,
  heartbeatTopicFor,
  DetectionEvent,
  GateHeartbeat,
  VERSION,
} from '@rally-gate/shared';
import mqtt, { MqttClient } from 'mqtt';
import { ulid } from 'ulid';
import { config } from './config';
import { log } from './log';

/** The gate's MQTT link to rally-server: heartbeats and detections out. */
export class Uplink {
  private readonly client: MqttClient;

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
  constructor() {
    this.client = mqtt.connect(`mqtt://${config.mqttHost}:${config.mqttPort}`, {
      clientId: config.gateId,
      clean: false,
      queueQoSZero: false,
    });
    this.client.on('error', (err) => {
      // Message only: this repeats every reconnect, and the stack is always the same DNS/socket frames.
      // A failed dual-stack connect is an AggregateError with an empty message; its code is the useful part.
      const code = (err as NodeJS.ErrnoException).code;
      log.error(`mqtt error: ${err.message || code || err.name}`);
    });
  }

  /** Every (re)connect, including the first. */
  onConnect(listener: () => void): void {
    this.client.on('connect', () => {
      log.info(`connected to broker at ${config.mqttHost}:${config.mqttPort}`);
      listener();
    });
  }

  publishHeartbeat(): void {
    // Deliberately QoS 0: a heartbeat is a liveness ping that repeats every
    // HEARTBEAT_INTERVAL_MS, so a missed one is self-healing and queueing it
    // for redelivery would only report staleness as freshness.
    const heartbeat: GateHeartbeat = {
      capabilities: config.adapter,
      version: VERSION,
      // Stamped here rather than anywhere upstream: the server subtracts this
      // from arrival time to estimate this gate's clock offset, so it has to be
      // read as late as possible before the packet goes out.
      sentAt: new Date().toISOString(),
    };
    this.client.publish(
      heartbeatTopicFor(config.gateId),
      JSON.stringify(heartbeat),
    );
  }

  publishDetection(transponderId: string | undefined, timestamp: Date): void {
    const event: DetectionEvent = {
      eventId: ulid(),
      gateId: config.gateId,
      transponderId,
      timestampGate: timestamp.toISOString(),
      source: config.adapter,
    };
    // QoS 1: a lost detection is a driver with no time, and at-least-once is
    // safe because the server pipeline is idempotent — DetectionEventRecord is
    // keyed on the gate-generated `eventId`, and startRun/finishRun/recordSplit
    // all ignore repeats (stage-runs.service.ts).
    //
    // ponytail: in-memory retry only — a systemd restart still drops whatever
    // wasn't acked yet. Add a disk-backed mqtt.js outgoingStore if gates turn
    // out to lose detections across crashes in the field.
    this.client.publish(
      detectionTopicFor(config.gateId),
      JSON.stringify(event),
      { qos: 1 },
    );
    log.info(
      `published detection ${transponderId ? `for transponder ${transponderId}` : 'without transponder'} at ${event.timestampGate}`,
    );
  }

  end(): void {
    this.client.end();
  }
}

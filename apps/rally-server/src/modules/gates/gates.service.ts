import { ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import {
  AUTO_DISCOVER_GATES_KEY,
  CLOCK_CORRECTION_THRESHOLD_KEY,
  DEFAULT_CLOCK_CORRECTION_THRESHOLD_MS,
  DETECTION_TOPIC_PREFIX,
  gateConfigUrl,
  GateHeartbeat,
  HEARTBEAT_ONLINE_THRESHOLD_MS,
} from '@rally-gate/shared';
import { Repository } from 'typeorm';
import { SettingsService } from '../settings/settings.service';
import { GateAssignmentsService } from './gate-assignments.service';
import { Gate } from './gate.entity';

/**
 * `capabilities` is self-reported by the gate over an unauthenticated broker
 * and stored verbatim, so it needs a bound — the ValidationPipe guards HTTP
 * only. Generous next to the real values ("simulated", "openstint").
 */
const MAX_CAPABILITIES_LENGTH = 64;

/**
 * `arrivedAt - sentAt`, or null when the gate sent no usable `sentAt` (an
 * older gate-agent, or a garbled value) — null means "leave the previous
 * measurement alone", which is not the same as an offset of zero.
 *
 * Single most-recent sample, no averaging: crystal drift between two
 * heartbeats 15s apart is well under a millisecond, so a rolling filter
 * would only be smoothing transit jitter. Heartbeats are published at QoS 0
 * precisely so a stale one can't be redelivered later and poison this.
 *
 * One-way, so it cannot separate clock offset from transit time — the
 * deadband in `clockCorrectionMsFor` compensates. The precise figure is
 * chrony's own, reported separately as `chronyOffsetMs`.
 */
export function measureClockOffsetMs(
  sentAt: string | undefined,
  arrivedAt: Date,
): number | null {
  if (!sentAt) {
    return null;
  }
  const sentMs = new Date(sentAt).getTime();
  if (Number.isNaN(sentMs)) {
    return null;
  }
  return arrivedAt.getTime() - sentMs;
}

export interface GatePowerOffResult {
  gateId: string;
  ok: boolean;
  message?: string;
}

/**
 * Through gate-config's own endpoint rather than an MQTT command, so a gate
 * never listens for anything from the server (docs/architecture.md, "No
 * server → gate commands").
 */
async function powerOffGate(
  gateId: string,
  address: string,
): Promise<GatePowerOffResult> {
  try {
    const res = await fetch(`${gateConfigUrl(address)}api/power-off`, {
      method: 'POST',
      signal: AbortSignal.timeout(5000),
    });
    const body = (await res.json()) as { started?: boolean; output?: string };
    return body.started
      ? { gateId, ok: true }
      : { gateId, ok: false, message: body.output || `HTTP ${res.status}` };
  } catch (err) {
    return {
      gateId,
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

const HEARTBEAT_TOPIC_REGEX = new RegExp(
  `^${DETECTION_TOPIC_PREFIX}/([^/]+)/heartbeat$`,
);

@Injectable()
export class GatesService {
  constructor(
    @InjectRepository(Gate)
    private readonly gates: Repository<Gate>,
    private readonly settingsService: SettingsService,
    private readonly emitter: EventEmitter2,
    private readonly gateAssignmentsService: GateAssignmentsService,
  ) {}

  findAll(): Promise<Gate[]> {
    return this.gates.find();
  }

  findOne(id: string): Promise<Gate | null> {
    return this.gates.findOneBy({ id });
  }

  async upsert(gate: Gate): Promise<Gate> {
    await this.gates.save(gate);
    const saved = (await this.findOne(gate.id)) as Gate;
    this.emitter.emit('gate.updated', saved);
    return saved;
  }

  /**
   * Deleting a gate cascades to its gate assignments — see
   * `GateAssignmentsService.removeAllForGate` for the actual rules (hard
   * refusal if any referenced stage is ACTIVE/CLOSED, otherwise requires
   * `force` to confirm the cascade).
   */
  async remove(id: string, force = false): Promise<void> {
    await this.gateAssignmentsService.removeAllForGate(id, force);
    await this.gates.delete(id);
  }

  /**
   * End of the event: shuts down every gate seen within the online window.
   * Refused while a stage is active — a gate powered off mid-stage is drivers
   * with no time.
   */
  async powerOffAll(now = Date.now()): Promise<GatePowerOffResult[]> {
    if (await this.gateAssignmentsService.hasActiveStage()) {
      throw new ConflictException(
        'A stage is active — close it before shutting down the gates',
      );
    }
    const online = (await this.gates.find()).filter(
      (g) =>
        g.address &&
        g.lastHeartbeatAt &&
        now - g.lastHeartbeatAt.getTime() < HEARTBEAT_ONLINE_THRESHOLD_MS,
    );
    return Promise.all(online.map((g) => powerOffGate(g.id, g.address!)));
  }

  @OnEvent('mqtt.message')
  async handleMqttMessage({
    topic,
    payload,
    address,
  }: {
    topic: string;
    payload: Buffer;
    address?: string;
  }) {
    const match = HEARTBEAT_TOPIC_REGEX.exec(topic);
    if (!match) {
      return;
    }
    const [, gateId] = match;
    let heartbeat: GateHeartbeat = {};
    try {
      heartbeat = JSON.parse(payload.toString()) as GateHeartbeat;
    } catch {
      // heartbeat with no/invalid body still counts as "alive"
    }
    // Arrival is read here, at the edge, so the offset measures transit
    // rather than however long this handler queued behind other work.
    await this.recordHeartbeat(gateId, heartbeat, new Date(), address);
  }

  /**
   * How much to add to this gate's timestamps to bring them onto server
   * time. Zero unless the measured offset clears the threshold — see
   * `DEFAULT_CLOCK_CORRECTION_THRESHOLD_MS` for why a deadband rather than
   * always correcting.
   */
  async clockCorrectionMsFor(gate: Gate): Promise<number> {
    const offsetMs = gate.clockOffsetMs;
    if (!offsetMs) {
      return 0;
    }
    const thresholdMs = await this.settingsService.getNumber(
      CLOCK_CORRECTION_THRESHOLD_KEY,
      DEFAULT_CLOCK_CORRECTION_THRESHOLD_MS,
    );
    return Math.abs(offsetMs) >= thresholdMs ? offsetMs : 0;
  }

  /**
   * Ignores heartbeats from gates that were never manually added when
   * auto-discovery is off, rather than silently registering them — that's
   * the point of the setting (keep the roster to gates the marshal expects
   * at this event).
   */
  async recordHeartbeat(
    gateId: string,
    heartbeat: GateHeartbeat = {},
    arrivedAt: Date = new Date(),
    address?: string,
  ): Promise<Gate | null> {
    let gate = await this.gates.findOneBy({ id: gateId });
    if (!gate) {
      const autoDiscover = await this.settingsService.getBoolean(
        AUTO_DISCOVER_GATES_KEY,
        true,
      );
      if (!autoDiscover) {
        return null;
      }
      gate = this.gates.create({ id: gateId, name: gateId });
    }
    gate.lastHeartbeatAt = arrivedAt;
    if (typeof heartbeat.capabilities === 'string' && heartbeat.capabilities) {
      gate.capabilities = heartbeat.capabilities.slice(
        0,
        MAX_CAPABILITIES_LENGTH,
      );
    }
    if (address) {
      gate.address = address.replace(/^::ffff:/, '');
    }
    if (typeof heartbeat.version === 'string' && heartbeat.version) {
      gate.version = heartbeat.version.slice(0, MAX_CAPABILITIES_LENGTH);
    }
    // Always overwritten: a gate that stops reporting chrony must read as
    // unknown, not keep its last "synced".
    gate.chronySynced =
      typeof heartbeat.chronySynced === 'boolean'
        ? heartbeat.chronySynced
        : null;
    gate.chronyOffsetMs = Number.isFinite(heartbeat.chronyOffsetMs)
      ? Math.abs(heartbeat.chronyOffsetMs as number)
      : null;
    const offsetMs = measureClockOffsetMs(heartbeat.sentAt, arrivedAt);
    if (offsetMs !== null) {
      gate.clockOffsetMs = offsetMs;
    }
    const saved = await this.gates.save(gate);
    this.emitter.emit('gate.heartbeat', saved);
    return saved;
  }
}

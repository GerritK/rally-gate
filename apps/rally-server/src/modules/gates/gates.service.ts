import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { DETECTION_TOPIC_PREFIX, GateHeartbeat } from '@rally-gate/shared';
import { Repository } from 'typeorm';
import { SettingsService } from '../settings/settings.service';
import { GateAssignmentsService } from './gate-assignments.service';
import { Gate } from './gate.entity';

export const AUTO_DISCOVER_GATES_KEY = 'autoDiscoverGates';
export const CLOCK_CORRECTION_THRESHOLD_KEY = 'clockCorrectionThresholdMs';

/**
 * Below this, a measured offset is indistinguishable from network transit
 * time (the measurement is one-way), so correcting would inject latency
 * noise into clocks that may well be fine. Above it, the gate's clock is
 * unambiguously wrong — an unsynced Pi drifts seconds over an event, and one
 * booting from `fake-hwclock` with no RTC can be days out.
 *
 * Exposed as a setting because the right value depends on the site's network:
 * the floor is however long a heartbeat takes to arrive, and that is a
 * property of the rally's WiFi, not of this code.
 */
export const DEFAULT_CLOCK_CORRECTION_THRESHOLD_MS = 1_000;

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
 * ponytail: one-way, so it cannot separate clock offset from transit time.
 * Replace with a round-trip probe once the server->gate `sync` channel in
 * docs/architecture.md exists; the deadband in `clockCorrectionMsFor` is
 * what compensates until then.
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
    return this.findOne(gate.id) as Promise<Gate>;
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

  @OnEvent('mqtt.message')
  async handleMqttMessage({
    topic,
    payload,
  }: {
    topic: string;
    payload: Buffer;
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
    await this.recordHeartbeat(gateId, heartbeat, new Date());
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
    const offsetMs = measureClockOffsetMs(heartbeat.sentAt, arrivedAt);
    if (offsetMs !== null) {
      gate.clockOffsetMs = offsetMs;
    }
    const saved = await this.gates.save(gate);
    this.emitter.emit('gate.heartbeat', saved);
    return saved;
  }
}

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { DETECTION_TOPIC_PREFIX } from '@rally-gate/shared';
import { Repository } from 'typeorm';
import { SettingsService } from '../settings/settings.service';
import { GateAssignmentsService } from './gate-assignments.service';
import { Gate } from './gate.entity';

export const AUTO_DISCOVER_GATES_KEY = 'autoDiscoverGates';

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
    let capabilities: string | undefined;
    try {
      const body = JSON.parse(payload.toString()) as { capabilities?: string };
      capabilities = body.capabilities;
    } catch {
      // heartbeat with no/invalid body still counts as "alive"
    }
    await this.recordHeartbeat(gateId, capabilities);
  }

  /**
   * Ignores heartbeats from gates that were never manually added when
   * auto-discovery is off, rather than silently registering them — that's
   * the point of the setting (keep the roster to gates the marshal expects
   * at this event).
   */
  async recordHeartbeat(
    gateId: string,
    capabilities?: string,
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
    gate.lastHeartbeatAt = new Date();
    if (capabilities) {
      gate.capabilities = capabilities;
    }
    const saved = await this.gates.save(gate);
    this.emitter.emit('gate.heartbeat', saved);
    return saved;
  }
}

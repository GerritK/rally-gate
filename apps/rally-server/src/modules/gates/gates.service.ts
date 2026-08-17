import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { OnEvent } from '@nestjs/event-emitter';
import { DETECTION_TOPIC_PREFIX } from '@rally-gate/shared';
import { Repository } from 'typeorm';
import { Gate } from './gate.entity';

const HEARTBEAT_TOPIC_REGEX = new RegExp(`^${DETECTION_TOPIC_PREFIX}/([^/]+)/heartbeat$`);

@Injectable()
export class GatesService {
  constructor(
    @InjectRepository(Gate)
    private readonly gates: Repository<Gate>,
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

  @OnEvent('mqtt.message')
  async handleMqttMessage({ topic, payload }: { topic: string; payload: Buffer }) {
    const match = HEARTBEAT_TOPIC_REGEX.exec(topic);
    if (!match) {
      return;
    }
    const [, gateId] = match;
    let capabilities: string | undefined;
    try {
      capabilities = JSON.parse(payload.toString())?.capabilities;
    } catch {
      // heartbeat with no/invalid body still counts as "alive"
    }
    await this.recordHeartbeat(gateId, capabilities);
  }

  async recordHeartbeat(gateId: string, capabilities?: string): Promise<Gate> {
    const gate = (await this.gates.findOneBy({ id: gateId })) ?? this.gates.create({ id: gateId, name: gateId });
    gate.lastHeartbeatAt = new Date();
    if (capabilities) {
      gate.capabilities = capabilities;
    }
    return this.gates.save(gate);
  }
}

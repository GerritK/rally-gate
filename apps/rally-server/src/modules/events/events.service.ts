import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { OnEvent } from '@nestjs/event-emitter';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DetectionEvent, DETECTION_TOPIC_PREFIX, GateRole } from '@rally-gate/shared';
import { Repository } from 'typeorm';
import { Gate } from '../gates/gate.entity';
import { GatesService } from '../gates/gates.service';
import { VehiclesService } from '../vehicles/vehicles.service';
import { StageRunsService } from '../stage-runs/stage-runs.service';
import { DetectionEventRecord } from './detection-event.entity';

const DETECTION_TOPIC_REGEX = new RegExp(`^${DETECTION_TOPIC_PREFIX}/([^/]+)/detections$`);

@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name);

  constructor(
    @InjectRepository(DetectionEventRecord)
    private readonly events: Repository<DetectionEventRecord>,
    private readonly gatesService: GatesService,
    private readonly vehiclesService: VehiclesService,
    private readonly stageRunsService: StageRunsService,
    private readonly emitter: EventEmitter2,
  ) {}

  findRecent(limit = 100): Promise<DetectionEventRecord[]> {
    return this.events.find({ order: { timestampServer: 'DESC' }, take: limit });
  }

  @OnEvent('mqtt.message')
  async handleMqttMessage({ topic, payload }: { topic: string; payload: Buffer }) {
    const match = DETECTION_TOPIC_REGEX.exec(topic);
    if (!match) {
      return;
    }
    let detection: DetectionEvent;
    try {
      detection = JSON.parse(payload.toString());
    } catch {
      this.logger.warn(`Ignoring malformed detection payload on ${topic}`);
      return;
    }
    await this.processDetection(detection);
  }

  private async processDetection(detection: DetectionEvent): Promise<void> {
    const gate = await this.gatesService.findOne(detection.gateId);
    if (!gate) {
      this.logger.warn(`Detection from unknown gate ${detection.gateId}, storing without processing`);
    }
    const vehicle = await this.vehiclesService.findByTransponder(detection.transponderId);
    if (!vehicle) {
      this.logger.warn(`Detection for unregistered transponder ${detection.transponderId}`);
    }

    const record = this.events.create({
      eventId: detection.eventId,
      gateId: detection.gateId,
      transponderId: detection.transponderId,
      vehicleId: vehicle?.id,
      timestampGate: new Date(detection.timestampGate),
      timestampServer: new Date(),
      rawPayload: JSON.stringify(detection),
      processed: false,
    });
    await this.events.save(record);
    this.emitter.emit('detection.created', record);

    if (gate && vehicle) {
      await this.applyRules(gate, vehicle.id, record.timestampGate);
    }

    record.processed = true;
    await this.events.save(record);
  }

  private async applyRules(gate: Gate, vehicleId: string, at: Date): Promise<void> {
    const stageId = gate.stageId;
    if (!stageId) {
      return;
    }
    if (gate.role === GateRole.STAGE_START) {
      const run = await this.stageRunsService.startRun(vehicleId, stageId, at);
      this.emitter.emit('stage-run.updated', run);
    } else if (gate.role === GateRole.STAGE_FINISH) {
      const run = await this.stageRunsService.finishRun(vehicleId, stageId, at);
      if (run) {
        this.emitter.emit('stage-run.updated', run);
      }
    } else if (gate.role === GateRole.STAGE_SPLIT) {
      const split = await this.stageRunsService.recordSplit(vehicleId, stageId, gate, at);
      if (split) {
        this.emitter.emit('stage-run.split', split);
      }
    }
  }
}

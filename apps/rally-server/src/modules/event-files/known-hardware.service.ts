import { ApiErrorCode } from '@rally-gate/shared';
import {
  ConflictException,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Repository } from 'typeorm';
import { apiError } from '../../common/api-error';
import { Gate } from '../gates/gate.entity';
import { eventsDir } from './event-files';

export interface KnownGate {
  id: string;
  name: string;
}

/**
 * The gates this computer has seen across all its events, so a new event's
 * roster is picked from the club's gates on the Hardware page rather than
 * typed in again. Not copied in automatically: the roster should hold only
 * the gates meant for this event, so an offline one there is really missing.
 * Identity only — heartbeat, clock offset and capabilities belong to the
 * event. Keyed by `GATE_ID`: a gate given a new id in gate-config is a new
 * gate here, and the old entry stays until someone forgets it.
 *
 * A JSON file next to the event files rather than a database: it is a handful
 * of rows, and a club can copy it to a second laptop.
 */
@Injectable()
export class KnownHardwareService implements OnModuleInit {
  private readonly logger = new Logger(KnownHardwareService.name);
  private gates: KnownGate[] = [];

  constructor(
    @InjectRepository(Gate)
    private readonly eventGates: Repository<Gate>,
  ) {}

  async onModuleInit() {
    const path = this.path();
    if (!path) {
      return;
    }
    if (existsSync(path)) {
      try {
        this.gates = (
          JSON.parse(readFileSync(path, 'utf8')) as { gates: KnownGate[] }
        ).gates;
      } catch (err) {
        this.logger.warn(`Ignoring unreadable ${path}: ${String(err)}`);
      }
      return;
    }
    // First start with this feature: the open event's gates are the club's.
    this.gates = (await this.eventGates.find()).map(({ id, name }) => ({
      id,
      name,
    }));
    this.save();
  }

  list(): KnownGate[] {
    return this.gates;
  }

  forget(id: string): void {
    if (!this.path()) {
      throw new ConflictException(
        apiError(
          ApiErrorCode.KNOWN_HARDWARE_STANDALONE_ONLY,
          'Known hardware is only kept in the standalone package',
        ),
      );
    }
    this.gates = this.gates.filter((gate) => gate.id !== id);
    this.save();
  }

  @OnEvent('gate.heartbeat')
  @OnEvent('gate.updated')
  remember({ id, name }: Gate): void {
    if (!this.path()) {
      return;
    }
    const known = this.gates.find((gate) => gate.id === id);
    if (known?.name === name) {
      return;
    }
    this.gates = known
      ? this.gates.map((gate) => (gate.id === id ? { id, name } : gate))
      : [...this.gates, { id, name }];
    this.save();
  }

  private path(): string | null {
    const dir = eventsDir();
    return dir ? join(dir, 'hardware.json') : null;
  }

  private save(): void {
    writeFileSync(this.path()!, JSON.stringify({ gates: this.gates }, null, 2));
  }
}

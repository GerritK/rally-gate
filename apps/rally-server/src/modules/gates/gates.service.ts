import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Gate } from './gate.entity';

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
}

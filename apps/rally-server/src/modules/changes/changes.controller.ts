import { Controller, Get, Param } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { AccessRole, type ChangeView } from '@rally-gate/shared';
import { In, Repository } from 'typeorm';
import { Device } from '../auth/device.entity';
import { Invitation } from '../auth/invitation.entity';
import { ChangeRecord } from './change-record.entity';

@Controller('entries/:entryId/changes')
export class ChangesController {
  constructor(
    @InjectRepository(ChangeRecord)
    private readonly changes: Repository<ChangeRecord>,
    @InjectRepository(Device)
    private readonly devices: Repository<Device>,
    @InjectRepository(Invitation)
    private readonly invitations: Repository<Invitation>,
  ) {}

  /** Newest first, each naming its device the way a protest asks. */
  @Get()
  async findForEntry(@Param('entryId') entryId: string): Promise<ChangeView[]> {
    const records = await this.changes.find({
      where: { entryId },
      order: { at: 'DESC' },
    });
    const deviceIds = [
      ...new Set(records.flatMap((r) => (r.deviceId ? [r.deviceId] : []))),
    ];
    const devices = await this.devices.findBy({ id: In(deviceIds) });
    const invitations = await this.invitations.findBy({
      id: In(devices.flatMap((d) => (d.invitationId ? [d.invitationId] : []))),
    });
    const by = new Map(
      devices.map((device) => {
        const invitation = invitations.find(
          (i) => i.id === device.invitationId,
        );
        return [
          device.id,
          {
            deviceId: device.id,
            role: invitation?.role ?? AccessRole.ORGANISER,
            label: invitation?.label ?? null,
            number: device.number,
          },
        ];
      }),
    );
    return records.map((r) => ({
      id: r.id,
      at: r.at.toISOString(),
      action: r.action,
      stageId: r.stageId,
      before: r.before,
      after: r.after,
      by: r.deviceId ? (by.get(r.deviceId) ?? null) : null,
    }));
  }
}

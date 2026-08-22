import {
  ArgumentMetadata,
  BadRequestException,
  ValidationPipe,
} from '@nestjs/common';
import { CreateGateAssignmentDto, UpsertGateDto } from '../modules/gates/dto';
import { UpsertRallyInfoDto } from '../modules/rally-info/dto';
import {
  CorrectStageRunDto,
  CreateStageRunDto,
} from '../modules/stage-runs/dto';
import { CreateStageDto, UpdateStageDto } from '../modules/stages/dto';
import { CreateVehicleDto, UpdateVehicleDto } from '../modules/vehicles/dto';

/**
 * The DTOs are declarative, so what's worth testing isn't each decorator —
 * it's the guarantee the set of them adds up to: fields the server owns
 * cannot be set through a generic create/update. That's a property which
 * silently regresses the moment someone "helpfully" adds a field to a DTO,
 * and it can't be caught by typechecking, since a request body is erased at
 * runtime.
 *
 * Uses the same pipe configuration as `main.ts` so this tests the real
 * behaviour rather than a restatement of it.
 */
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

const asBody = (metatype: new () => object): ArgumentMetadata => ({
  type: 'body',
  metatype,
});

async function transform(
  metatype: new () => object,
  body: unknown,
): Promise<unknown> {
  return (await pipe.transform(body, asBody(metatype))) as unknown;
}

/**
 * Returns the per-field messages of a rejected payload. `BadRequestException`
 * itself only stringifies to "Bad Request Exception" — the detail naming the
 * offending property lives in the response body, and asserting on that is
 * what makes these tests check the *right* field was caught.
 */
async function rejectionMessages(
  metatype: new () => object,
  body: unknown,
): Promise<string> {
  try {
    await transform(metatype, body);
  } catch (err) {
    if (err instanceof BadRequestException) {
      const response = err.getResponse() as { message?: string[] | string };
      return [response.message ?? []].flat().join('; ');
    }
    throw err;
  }
  throw new Error(
    `expected ${metatype.name} to reject ${JSON.stringify(body)}, but it was accepted`,
  );
}

describe('server-owned fields are not settable through the API', () => {
  // Each case: a field the server alone controls, and the payload that would
  // have written it before the pipe existed.
  const forbidden: [
    string,
    new () => object,
    Record<string, unknown>,
    string,
  ][] = [
    // Would flip a stage ACTIVE/CLOSED without touching its GateAssignment
    // rows, desynchronising the plan-vs-live split in architecture.md.
    [
      'Stage.status on create',
      CreateStageDto,
      { id: 'WP1', name: 'Pass', stageNumber: 1, status: 'ACTIVE' },
      'status',
    ],
    [
      'Stage.status on update',
      UpdateStageDto,
      { name: 'Pass', stageNumber: 1, status: 'CLOSED' },
      'status',
    ],
    // Object.assign in VehiclesService.update would retarget the save.
    [
      'Vehicle.id on update',
      UpdateVehicleDto,
      { id: 'some-other-uuid', driverName: 'Mallory' },
      'id',
    ],
    // Would make an offline gate look alive on the Hardware page.
    [
      'Gate.lastHeartbeatAt',
      UpsertGateDto,
      { name: 'Start', lastHeartbeatAt: new Date().toISOString() },
      'lastHeartbeatAt',
    ],
    // Would make a gate live while skipping the cross-stage conflict check.
    [
      'GateAssignment.active',
      CreateGateAssignmentDto,
      { gateId: 'g1', stageId: 'WP1', role: 'stage_start', active: true },
      'active',
    ],
    // Singleton pinned to RALLY_INFO_ID; an id could only make a stray row.
    ['RallyInfo.id', UpsertRallyInfoDto, { name: 'Rally', id: 'other' }, 'id'],
  ];

  it.each(forbidden)(
    'rejects %s',
    async (_label, metatype, body, offendingField) => {
      const messages = await rejectionMessages(metatype, body);
      expect(messages).toContain(`property ${offendingField} should not exist`);
    },
  );
});

describe('valid payloads still pass', () => {
  it('accepts a stage create without status', async () => {
    await expect(
      transform(CreateStageDto, { id: 'WP1', name: 'Pass', stageNumber: 1 }),
    ).resolves.toMatchObject({ id: 'WP1', stageNumber: 1 });
  });

  it('accepts null to clear an optional vehicle field', async () => {
    // null is not "absent": only null actually writes SQL NULL (CLAUDE.md),
    // so the DTO has to let it through rather than strip it.
    await expect(
      transform(UpdateVehicleDto, { coDriverName: null }),
    ).resolves.toEqual({ coDriverName: null });
  });

  it('accepts null finishTime to reopen a run', async () => {
    await expect(
      transform(CorrectStageRunDto, { finishTime: null }),
    ).resolves.toEqual({ finishTime: null });
  });
});

describe('malformed values are rejected at the boundary', () => {
  it.each([
    ['a non-ISO start time', CreateStageRunDto, 'yesterday-ish'],
    ['an empty start time', CreateStageRunDto, ''],
  ])('rejects %s', async (_label, metatype, startTime) => {
    const messages = await rejectionMessages(metatype, {
      vehicleId: 'v1',
      stageId: 's1',
      startTime,
    });
    expect(messages).toMatch(/startTime/);
  });

  it('rejects a stage id that would break its own route', async () => {
    const messages = await rejectionMessages(CreateStageDto, {
      id: 'WP 1/../x',
      name: 'Pass',
      stageNumber: 1,
    });
    expect(messages).toMatch(/id may only contain/);
  });

  it('rejects an unknown gate role', async () => {
    const messages = await rejectionMessages(CreateGateAssignmentDto, {
      gateId: 'g1',
      stageId: 'WP1',
      role: 'teleporter',
    });
    expect(messages).toMatch(/role/);
  });

  it('rejects an unknown vehicle status', async () => {
    const messages = await rejectionMessages(CreateVehicleDto, {
      startNumber: '1',
      driverName: 'A',
      status: 'VIBING',
    });
    expect(messages).toMatch(/status/);
  });
});

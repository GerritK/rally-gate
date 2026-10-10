import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RallyStatus } from '@rally-gate/shared';
import { RallyInfoService } from './rally-info.service';

const LOCKED_WHEN = 'lockedWhen';

/** Refuses the route with a 409 while the rally is in one of `statuses`. */
export const LockedWhen = (...statuses: RallyStatus[]) =>
  SetMetadata(LOCKED_WHEN, statuses);

/** Global (`APP_GUARD`); a route without `@LockedWhen` costs nothing. */
@Injectable()
export class RallyLockGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly rallyInfo: RallyInfoService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const statuses = this.reflector.get<RallyStatus[] | undefined>(
      LOCKED_WHEN,
      context.getHandler(),
    );
    if (statuses) await this.rallyInfo.assertNotIn(...statuses);
    return true;
  }
}

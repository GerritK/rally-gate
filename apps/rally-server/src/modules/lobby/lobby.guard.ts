import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiErrorCode } from '@rally-gate/shared';
import type { Request } from 'express';
import { randomBytes } from 'node:crypto';
import { apiError } from '../../common/api-error';
import {
  assertSameOrigin,
  cookieValue,
  isLoopback,
  PUBLIC,
} from '../auth/auth.guard';

/** Not the device cookie: that one still logs the browser in to the event it
 *  came from, once that event is open again. */
export const LOBBY_COOKIE = 'rally_gate_lobby';

/**
 * Organiser logins by password while no event is open, in memory: devices
 * live in the event database, and a lobby lasts only until an event is
 * picked.
 */
@Injectable()
export class LobbyLogins {
  private readonly tokens = new Set<string>();

  create(): string {
    const token = randomBytes(32).toString('base64url');
    this.tokens.add(token);
    return token;
  }

  isOrganiser(req: Request): boolean {
    const token = cookieValue(req, LOBBY_COOKIE);
    return isLoopback(req) || (!!token && this.tokens.has(token));
  }
}

/** Global in the lobby: the organiser picks an event, everyone else waits. */
@Injectable()
export class LobbyGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly logins: LobbyLogins,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    assertSameOrigin(req);
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC, targets)) return true;
    if (this.logins.isOrganiser(req)) return true;
    throw new ServiceUnavailableException(
      apiError(ApiErrorCode.NO_EVENT_OPEN, 'No event is open yet'),
    );
  }
}

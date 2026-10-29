import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AccessRole, ApiErrorCode } from '@rally-gate/shared';
import type { Request } from 'express';
import { apiError } from '../../common/api-error';
import { AuthService, type Principal } from './auth.service';

export const DEVICE_COOKIE = 'rally_gate_device';

const ROLES = 'roles';
const PUBLIC = 'public';
const PRIVATE = 'private';

/**
 * Who besides the organiser may call a changing route. A changing route
 * without it is the organiser's only, so a new endpoint is closed by default.
 */
export const Roles = (...roles: AccessRole[]) => SetMetadata(ROLES, roles);

/** Changing routes anyone may call: logging in. */
export const Public = () => SetMetadata(PUBLIC, true);

/** A read that needs the role check too: invitation codes, devices. */
export const Private = () => SetMetadata(PRIVATE, true);

type AuthedRequest = Request & { principal?: Principal | null };

/** The request's login, null when there is none. */
export const CurrentPrincipal = createParamDecorator(
  (_: unknown, context: ExecutionContext) =>
    context.switchToHttp().getRequest<AuthedRequest>().principal ?? null,
);

// Checked on the socket, never a header: anyone can send X-Forwarded-For.
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

export function cookieValue(req: Request, name: string): string | null {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return null;
}

/**
 * Global (`APP_GUARD`). Reads stay open until the public page lands
 * (`docs/auth.md`) unless `@Private`; every other method needs a login whose role the route
 * allows.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    req.principal = await this.resolve(req);

    const targets = [context.getHandler(), context.getClass()];
    const read = req.method === 'GET' || req.method === 'HEAD';
    if (read && !this.reflector.getAllAndOverride<boolean>(PRIVATE, targets)) {
      return true;
    }
    // Without CORS a foreign page still gets a plain form POST through, and
    // on the server machine that would be the organiser. Browsers always
    // send Origin on a POST; curl and the seed script send none.
    const origin = req.headers.origin;
    if (origin && new URL(origin).host !== req.headers.host) {
      throw new ForbiddenException(
        apiError(ApiErrorCode.FOREIGN_ORIGIN, `Refused request from ${origin}`),
      );
    }
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC, targets)) return true;

    const principal = req.principal;
    if (!principal) {
      throw new UnauthorizedException(
        apiError(ApiErrorCode.LOGIN_REQUIRED, 'Log in first'),
      );
    }
    const roles =
      this.reflector.getAllAndOverride<AccessRole[]>(ROLES, targets) ?? [];
    if (
      principal.role === AccessRole.ORGANISER ||
      roles.includes(principal.role)
    ) {
      return true;
    }
    throw new ForbiddenException(
      apiError(
        ApiErrorCode.ROLE_NOT_ALLOWED,
        `${principal.role} may not do this`,
      ),
    );
  }

  private async resolve(req: Request): Promise<Principal | null> {
    if (LOOPBACK.has(req.socket.remoteAddress ?? '')) {
      return { role: AccessRole.ORGANISER, device: null, invitation: null };
    }
    const token = cookieValue(req, DEVICE_COOKIE);
    return token ? this.auth.principalForToken(token) : null;
  }
}

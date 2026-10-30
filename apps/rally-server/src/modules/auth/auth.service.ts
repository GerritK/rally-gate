import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnApplicationBootstrap,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  AccessRole,
  ApiErrorCode,
  mayDo,
  type AuthDevice,
  type AuthSession,
  type Permission,
} from '@rally-gate/shared';
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { IsNull, Repository } from 'typeorm';
import { apiError } from '../../common/api-error';
import { eventsDir } from '../event-files/event-files';
import { Device } from './device.entity';
import { CreateInvitationDto } from './dto';
import { Invitation } from './invitation.entity';
import { LoginLimit } from './login-limit';
import {
  ensureSetupToken,
  passwordSet,
  setupInstructions,
  verifyPassword,
} from './organiser';

/** Stored on every `ChangeRecord`; null is the server machine. */
export const deviceOf = (principal: Principal) => principal.device?.id ?? null;

/** Who sent a request; attached by `AuthGuard`. */
export interface Principal {
  role: AccessRole;
  /** Null: the server machine itself. */
  device: Device | null;
  invitation: Invitation | null;
}

// No 0/O, 1/I/L: typed off paper on a phone in the forest.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;

const hashToken = (token: string) =>
  createHash('sha256').update(token).digest('hex');

/** Typed codes come with spaces, dashes and lower case. */
export const normaliseCode = (code: string) =>
  code.toUpperCase().replace(/[^A-Z0-9]/g, '');

@Injectable()
export class AuthService implements OnApplicationBootstrap {
  private readonly loginLimit = new LoginLimit();

  constructor(
    @InjectRepository(Invitation)
    private readonly invitations: Repository<Invitation>,
    @InjectRepository(Device)
    private readonly devices: Repository<Device>,
  ) {}

  async onApplicationBootstrap() {
    // The standalone laptop is the organiser by itself; a QR code in its
    // console would only puzzle. Its password is set on the dashboard.
    if (eventsDir() || passwordSet()) return;
    // Not through the logger: the line has to survive LOG_LEVEL=warn.
    console.log(await setupInstructions(ensureSetupToken()));
  }

  /** Null: an unknown, blocked or missing cookie. */
  async principalForToken(token: string): Promise<Principal | null> {
    const device = await this.devices.findOneBy({
      tokenHash: hashToken(token),
    });
    if (!device || device.blocked) return null;
    if (!device.invitationId) {
      return { role: AccessRole.ORGANISER, device, invitation: null };
    }
    const invitation = await this.invitations.findOneBy({
      id: device.invitationId,
    });
    if (!invitation || invitation.blocked) return null;
    return { role: invitation.role, device, invitation };
  }

  session(principal: Principal | null): AuthSession {
    return {
      role: principal?.role ?? null,
      deviceId: principal?.device?.id ?? null,
      label: principal?.invitation?.label ?? null,
      deviceNumber: principal?.device?.number ?? null,
      stageIds: principal?.invitation?.stageIds ?? [],
      passwordSet: passwordSet(),
    };
  }

  /**
   * Returns the cookie value of the new device, or null when `current` is
   * already a device of that invitation: scanning twice must not fill the
   * organiser's device list.
   */
  async redeem(
    code: string,
    current: Principal | null,
  ): Promise<{ token: string | null; principal: Principal }> {
    const invitation = await this.invitations.findOneBy({
      code: normaliseCode(code),
    });
    if (!invitation || invitation.blocked) {
      throw new UnauthorizedException(
        apiError(ApiErrorCode.INVITATION_INVALID, 'Unknown or blocked code'),
      );
    }
    if (current?.invitation?.id === invitation.id) {
      return { token: null, principal: current };
    }
    const { token, device } = await this.createDevice(invitation.id);
    return { token, principal: { role: invitation.role, device, invitation } };
  }

  /** `address`: the socket's, never a header (see `AuthGuard`). */
  async login(
    password: string,
    address: string,
  ): Promise<{ token: string; principal: Principal }> {
    this.loginLimit.check(address);
    if (!verifyPassword(password)) {
      this.loginLimit.failed(address);
      throw new UnauthorizedException(
        apiError(ApiErrorCode.PASSWORD_WRONG, 'Wrong password'),
      );
    }
    this.loginLimit.succeeded(address);
    const { token, device } = await this.createDevice(null);
    return {
      token,
      principal: { role: AccessRole.ORGANISER, device, invitation: null },
    };
  }

  private async createDevice(
    invitationId: string | null,
  ): Promise<{ token: string; device: Device }> {
    const token = randomBytes(32).toString('base64url');
    const number =
      (await this.devices.countBy({ invitationId: invitationId ?? IsNull() })) +
      1;
    const device = await this.devices.save(
      this.devices.create({
        invitationId,
        number,
        tokenHash: hashToken(token),
        blocked: false,
        createdAt: new Date(),
      }),
    );
    return { token, device };
  }

  listInvitations(): Promise<Invitation[]> {
    return this.invitations.find({ order: { createdAt: 'ASC' } });
  }

  async createInvitation(body: CreateInvitationDto): Promise<Invitation> {
    for (;;) {
      const code = Array.from(
        { length: CODE_LENGTH },
        () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)],
      ).join('');
      if (await this.invitations.existsBy({ code })) continue;
      return this.invitations.save(
        this.invitations.create({
          label: body.label,
          role: body.role,
          // Only a marshal is scoped; stored for no one else.
          stageIds:
            body.role === AccessRole.STAGE_MARSHAL ? (body.stageIds ?? []) : [],
          code,
          blocked: false,
          createdAt: new Date(),
        }),
      );
    }
  }

  async setInvitationBlocked(
    id: string,
    blocked: boolean,
  ): Promise<Invitation> {
    const invitation = await this.invitations.findOneBy({ id });
    if (!invitation) {
      throw new NotFoundException(
        apiError(ApiErrorCode.INVITATION_NOT_FOUND, `No invitation ${id}`),
      );
    }
    invitation.blocked = blocked;
    return this.invitations.save(invitation);
  }

  async listDevices(): Promise<AuthDevice[]> {
    const devices = await this.devices.find({ order: { createdAt: 'ASC' } });
    return devices.map((device) => ({
      id: device.id,
      invitationId: device.invitationId,
      number: device.number,
      blocked: device.blocked,
      createdAt: device.createdAt.toISOString(),
    }));
  }

  async setDeviceBlocked(id: string, blocked: boolean): Promise<void> {
    const device = await this.devices.findOneBy({ id });
    if (!device) {
      throw new NotFoundException(
        apiError(ApiErrorCode.DEVICE_NOT_FOUND, `No device ${id}`),
      );
    }
    device.blocked = blocked;
    await this.devices.save(device);
  }
}

/**
 * The handler's own check where the guard can't decide: a stage marshal's
 * stage, or what an entry's status change needs. Null `stageId` (a passing
 * at a gate with no active stage) is no marshal's.
 */
export function assertMay(
  principal: Principal,
  permission: Permission,
  stageId?: string | null,
): void {
  const login = {
    role: principal.role,
    stageIds: principal.invitation?.stageIds ?? [],
  };
  if (mayDo(login, permission, stageId)) return;
  const stageOnly =
    principal.role === AccessRole.STAGE_MARSHAL &&
    mayDo({ ...login, stageIds: [stageId ?? ''] }, permission, stageId);
  throw new ForbiddenException(
    stageOnly
      ? apiError(
          ApiErrorCode.STAGE_NOT_YOURS,
          'This login may only change the stages on its invitation',
        )
      : apiError(
          ApiErrorCode.ROLE_NOT_ALLOWED,
          `${principal.role} may not do this`,
        ),
  );
}

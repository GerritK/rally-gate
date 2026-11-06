import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { AccessRole, ApiErrorCode, type AuthSession } from '@rally-gate/shared';
import type { Request, Response } from 'express';
import { apiError } from '../../common/api-error';
import { Public } from '../auth/auth.guard';
import { LoginDto } from '../auth/dto';
import { LoginLimit } from '../auth/login-limit';
import { passwordSet, verifyPassword } from '../auth/organiser';
import { LOBBY_COOKIE, LobbyLogins } from './lobby.guard';

/** The lobby's stand-in for `AuthController`: the organiser only. */
@Public()
@Controller('auth')
export class LobbyAuthController {
  private readonly loginLimit = new LoginLimit();

  constructor(private readonly logins: LobbyLogins) {}

  @Get('session')
  session(@Req() req: Request): AuthSession {
    return this.sessionOf(this.logins.isOrganiser(req));
  }

  @Post('login')
  @HttpCode(200)
  login(
    @Body() body: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): AuthSession {
    const address = req.socket.remoteAddress ?? '';
    this.loginLimit.check(address);
    if (!verifyPassword(body.password)) {
      this.loginLimit.failed(address);
      throw new UnauthorizedException(
        apiError(ApiErrorCode.PASSWORD_WRONG, 'Wrong password'),
      );
    }
    this.loginLimit.succeeded(address);
    res.cookie(LOBBY_COOKIE, this.logins.create(), {
      httpOnly: true,
      sameSite: 'strict',
      path: '/',
    });
    return this.sessionOf(true);
  }

  @Post('logout')
  @HttpCode(204)
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(LOBBY_COOKIE, { path: '/' });
  }

  /** Invitations live in the event, so none is known yet. */
  @Post('redeem')
  redeem() {
    throw new ServiceUnavailableException(
      apiError(ApiErrorCode.NO_EVENT_OPEN, 'No event is open yet'),
    );
  }

  private sessionOf(organiser: boolean): AuthSession {
    return {
      role: organiser ? AccessRole.ORGANISER : null,
      deviceId: null,
      label: null,
      deviceNumber: null,
      stageIds: [],
      passwordSet: passwordSet(),
      lobby: true,
    };
  }
}

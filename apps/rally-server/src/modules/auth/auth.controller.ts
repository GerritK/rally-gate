import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiErrorCode } from '@rally-gate/shared';
import type { Response } from 'express';
import { apiError } from '../../common/api-error';
import { CurrentPrincipal, DEVICE_COOKIE, Private, Public } from './auth.guard';
import { AuthService, type Principal } from './auth.service';
import {
  CreateInvitationDto,
  LoginDto,
  RedeemDto,
  SetBlockedDto,
  SetPasswordDto,
  SetupDto,
} from './dto';
import { setPassword, setupTokenMatches } from './organiser';

/**
 * No expiry: a marshal logged out mid-stage is worse than the remaining
 * risk. Strict, because `EventSource` can't send a header, so a cookie it is.
 */
function setDeviceCookie(res: Response, token: string): void {
  res.cookie(DEVICE_COOKIE, token, {
    httpOnly: true,
    sameSite: 'strict',
    path: '/',
    maxAge: 10 * 365 * 24 * 3600 * 1000,
  });
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Get('session')
  session(@CurrentPrincipal() principal: Principal | null) {
    return this.auth.session(principal);
  }

  @Public()
  @Post('redeem')
  @HttpCode(200)
  async redeem(
    @Body() body: RedeemDto,
    @CurrentPrincipal() current: Principal | null,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { token, principal } = await this.auth.redeem(body.code, current);
    if (token) setDeviceCookie(res, token);
    return this.auth.session(principal);
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(
    @Body() body: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { token, principal } = await this.auth.login(body.password);
    setDeviceCookie(res, token);
    return this.auth.session(principal);
  }

  /** The device stays listed; this browser just forgets it. */
  @Public()
  @Post('logout')
  @HttpCode(204)
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(DEVICE_COOKIE, { path: '/' });
  }

  /** The first password, from the setup link the server logs. */
  @Public()
  @Post('setup')
  @HttpCode(204)
  setup(@Body() body: SetupDto) {
    if (!setupTokenMatches(body.token)) {
      throw new UnauthorizedException(
        apiError(ApiErrorCode.SETUP_LINK_INVALID, 'Setup link not valid'),
      );
    }
    setPassword(body.password);
  }

  /** Organiser only, e.g. on the standalone laptop after forgetting it. */
  @Put('password')
  @HttpCode(204)
  password(@Body() body: SetPasswordDto) {
    setPassword(body.password);
  }

  @Private()
  @Get('invitations')
  invitations() {
    return this.auth.listInvitations();
  }

  @Post('invitations')
  createInvitation(@Body() body: CreateInvitationDto) {
    return this.auth.createInvitation(body);
  }

  @Patch('invitations/:id')
  setInvitationBlocked(@Param('id') id: string, @Body() body: SetBlockedDto) {
    return this.auth.setInvitationBlocked(id, body.blocked);
  }

  @Private()
  @Get('devices')
  devices() {
    return this.auth.listDevices();
  }

  @Patch('devices/:id')
  setDeviceBlocked(@Param('id') id: string, @Body() body: SetBlockedDto) {
    return this.auth.setDeviceBlocked(id, body.blocked);
  }
}

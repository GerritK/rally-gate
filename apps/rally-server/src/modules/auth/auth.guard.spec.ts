import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  AccessRole,
  entryStatusPermission,
  EntryStatus,
} from '@rally-gate/shared';
import { AuthGuard, Private, Public, Requires } from './auth.guard';
import { assertMay, AuthService, type Principal } from './auth.service';
import { Invitation } from './invitation.entity';

class Routes {
  @Requires('activateStage')
  timing() {}
  organiserOnly() {}
  @Public()
  login() {}
  @Private()
  invitations() {}
}

const marshal: Principal = {
  role: AccessRole.STAGE_MARSHAL,
  device: null,
  invitation: { stageIds: ['ss2'] } as Invitation,
};

function run(
  handler: keyof Routes,
  method: string,
  opts: {
    address?: string;
    cookie?: string;
    principal?: Principal | null;
    origin?: string;
    host?: string;
  },
) {
  const auth = {
    principalForToken: () => Promise.resolve(opts.principal ?? null),
  } as unknown as AuthService;
  const req = {
    method,
    socket: { remoteAddress: opts.address ?? '192.168.1.20' },
    headers: { cookie: opts.cookie, origin: opts.origin, host: opts.host },
  };
  const context = {
    switchToHttp: () => ({ getRequest: () => req }),
    // Only read as a metadata key, never called.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    getHandler: () => Routes.prototype[handler],
    getClass: () => Routes,
  } as unknown as ExecutionContext;
  return new AuthGuard(new Reflector(), auth).canActivate(context);
}

const withCookie = (principal: Principal) => ({
  cookie: 'other=1; rally_gate_device=abc',
  principal,
});

describe('AuthGuard', () => {
  it('lets anyone read, but not a @Private read', async () => {
    await expect(run('timing', 'GET', {})).resolves.toBe(true);
    await expect(run('invitations', 'GET', {})).rejects.toThrow('Log in');
  });

  it('refuses a change without a login', async () => {
    await expect(run('timing', 'POST', {})).rejects.toThrow('Log in');
  });

  it('treats the server machine as the organiser, by socket address', async () => {
    await expect(
      run('organiserOnly', 'POST', { address: '::ffff:127.0.0.1' }),
    ).resolves.toBe(true);
  });

  it('allows a role only where the route names it', async () => {
    const timing = withCookie({
      role: AccessRole.TIMING,
      device: null,
      invitation: null,
    });
    await expect(run('timing', 'POST', timing)).resolves.toBe(true);
    await expect(run('organiserOnly', 'POST', timing)).rejects.toThrow(
      'may not',
    );
  });

  it('refuses a change from another web page, even on the server machine', async () => {
    const local = { address: '127.0.0.1', host: 'localhost:57430' };
    await expect(
      run('organiserOnly', 'POST', { ...local, origin: 'http://evil.example' }),
    ).rejects.toThrow('Refused');
    await expect(
      run('organiserOnly', 'POST', {
        ...local,
        origin: 'http://localhost:57430',
      }),
    ).resolves.toBe(true);
  });

  it('opens @Public changes to everyone', async () => {
    await expect(run('login', 'POST', {})).resolves.toBe(true);
  });
});

describe('assertMay', () => {
  it('limits a stage marshal to its stages', () => {
    expect(() => assertMay(marshal, 'correctRun', 'ss2')).not.toThrow();
    expect(() => assertMay(marshal, 'correctRun', 'ss1')).toThrow(
      'stages on its invitation',
    );
    expect(() => assertMay(marshal, 'correctRun', null)).toThrow();
    expect(() => assertMay(marshal, 'voidRun', 'ss2')).toThrow('may not');
  });

  it('leaves the stage alone for every other role', () => {
    const timing = { ...marshal, role: AccessRole.TIMING };
    expect(() => assertMay(timing, 'correctRun', 'ss1')).not.toThrow();
  });

  it('keeps disqualifying for the organiser', () => {
    const checkIn = { ...marshal, role: AccessRole.CHECK_IN };
    const timing = { ...marshal, role: AccessRole.TIMING };
    const need = (from: EntryStatus, to: EntryStatus) =>
      entryStatusPermission(from, to);
    const { REGISTERED, CHECKED_IN, WITHDRAWN, DISQUALIFIED } = EntryStatus;
    expect(() =>
      assertMay(checkIn, need(REGISTERED, CHECKED_IN)),
    ).not.toThrow();
    expect(() =>
      assertMay(checkIn, need(CHECKED_IN, REGISTERED)),
    ).not.toThrow();
    expect(() => assertMay(timing, need(CHECKED_IN, WITHDRAWN))).not.toThrow();
    expect(() => assertMay(timing, need(CHECKED_IN, REGISTERED))).toThrow();
    expect(() => assertMay(checkIn, need(CHECKED_IN, DISQUALIFIED))).toThrow();
    expect(() => assertMay(timing, need(DISQUALIFIED, CHECKED_IN))).toThrow();
  });
});

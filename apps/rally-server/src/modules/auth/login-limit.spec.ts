import { HttpException } from '@nestjs/common';
import { LoginLimit } from './login-limit';

describe('LoginLimit', () => {
  let now: number;
  let limit: LoginLimit;

  beforeEach(() => {
    now = 1_000_000;
    limit = new LoginLimit(() => now);
  });

  const failTimes = (address: string, times: number) => {
    for (let i = 0; i < times; i++) {
      limit.check(address);
      limit.failed(address);
    }
  };

  it('refuses the sixth attempt within a minute, with the seconds to wait', () => {
    failTimes('10.0.0.5', 5);
    now += 20_000;
    try {
      limit.check('10.0.0.5');
      fail('expected a refusal');
    } catch (err) {
      expect(err).toBeInstanceOf(HttpException);
      expect((err as HttpException).getStatus()).toBe(429);
      expect((err as HttpException).getResponse()).toMatchObject({
        code: 'tooManyAttempts',
        params: { seconds: 40 },
      });
    }
  });

  it('lets the address try again once the window has passed', () => {
    failTimes('10.0.0.5', 5);
    now += 60_000;
    expect(() => limit.check('10.0.0.5')).not.toThrow();
    failTimes('10.0.0.5', 4);
    expect(() => limit.check('10.0.0.5')).not.toThrow();
  });

  it('clears the address on a right password', () => {
    failTimes('10.0.0.5', 4);
    limit.succeeded('10.0.0.5');
    failTimes('10.0.0.5', 4);
    expect(() => limit.check('10.0.0.5')).not.toThrow();
  });

  it('counts each address on its own', () => {
    failTimes('10.0.0.5', 5);
    expect(() => limit.check('10.0.0.6')).not.toThrow();
    expect(() => limit.check('10.0.0.5')).toThrow(HttpException);
  });
});

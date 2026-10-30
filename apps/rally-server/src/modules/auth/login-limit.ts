import { HttpException, HttpStatus } from '@nestjs/common';
import { ApiErrorCode } from '@rally-gate/shared';
import { apiError } from '../../common/api-error';

const MAX_FAILURES = 5;
const WINDOW_MS = 60_000;

/**
 * Wrong organiser passwords per client address, in memory: a restart
 * forgets them, which costs an attacker a minute at most anyway. The window
 * runs from an address's first failure; a right password clears it.
 */
export class LoginLimit {
  private readonly failures = new Map<
    string,
    { count: number; until: number }
  >();

  constructor(private readonly now = () => Date.now()) {}

  /** Throws 429 while the address has used up its attempts. */
  check(address: string): void {
    const now = this.now();
    for (const [key, entry] of this.failures) {
      if (entry.until <= now) this.failures.delete(key);
    }
    const entry = this.failures.get(address);
    if (entry && entry.count >= MAX_FAILURES) {
      const seconds = Math.ceil((entry.until - now) / 1000);
      throw new HttpException(
        apiError(
          ApiErrorCode.TOO_MANY_ATTEMPTS,
          `Too many wrong passwords, retry in ${seconds} s`,
          { seconds },
        ),
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  failed(address: string): void {
    const entry = this.failures.get(address);
    if (entry) entry.count++;
    else
      this.failures.set(address, { count: 1, until: this.now() + WINDOW_MS });
  }

  succeeded(address: string): void {
    this.failures.delete(address);
  }
}

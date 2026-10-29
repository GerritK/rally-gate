import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ensureSetupToken,
  passwordSet,
  setPassword,
  setupTokenMatches,
  verifyPassword,
} from './organiser';

describe('organiser password', () => {
  const env = process.env;
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'organiser-'));
    process.env = { ...env, CONFIG_DIR: dir };
  });

  afterEach(() => {
    process.env = env;
    rmSync(dir, { recursive: true, force: true });
  });

  it('verifies only the password that was set', () => {
    expect(passwordSet()).toBe(false);
    expect(verifyPassword('anything')).toBe(false);
    setPassword('correct horse');
    expect(passwordSet()).toBe(true);
    expect(verifyPassword('correct horse')).toBe(true);
    expect(verifyPassword('wrong horse')).toBe(false);
  });

  it('keeps the setup link across restarts until a password is set', () => {
    const token = ensureSetupToken();
    expect(ensureSetupToken()).toBe(token);
    expect(setupTokenMatches(token)).toBe(true);
    expect(setupTokenMatches('guess')).toBe(false);
    setPassword('correct horse');
    expect(setupTokenMatches(token)).toBe(false);
  });

  it('reset forgets the password and makes a new link', () => {
    setPassword('correct horse');
    const token = ensureSetupToken(true);
    expect(passwordSet()).toBe(false);
    expect(setupTokenMatches(token)).toBe(true);
  });
});

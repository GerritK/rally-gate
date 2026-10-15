import { execFileSync } from 'child_process';

/**
 * libgpiod v1 (Pi OS Bookworm) and v2 (Trixie) take different arguments: v1
 * needs chip + offset, looked up with `gpiofind`; v2 takes the line name.
 * Throws when the gpiod tools aren't installed.
 */
export function isLibgpiodV1(): boolean {
  const version = execFileSync('gpiomon', ['--version'], { encoding: 'utf8' });
  return /v1\./.test(version);
}

export function findLine(line: string): [chip: string, offset: string] {
  const [chip, offset] = execFileSync('gpiofind', [line], { encoding: 'utf8' })
    .trim()
    .split(/\s+/);
  return [chip, offset];
}

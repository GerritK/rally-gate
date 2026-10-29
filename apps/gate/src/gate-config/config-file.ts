import { randomBytes } from 'crypto';
import { readFileSync, renameSync, unlinkSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { FIELDS, FieldName, GateConfig, isFieldName } from '../fields';
import { CONFIG_PATH } from '../paths';

/**
 * Parses systemd's EnvironmentFile format, restricted to what this service
 * writes: `KEY=value`, `#` comments, blank lines. Quoting and line
 * continuations are not supported — values that would need them are rejected by
 * `validate`, so round-tripping stays exact.
 */
export function parseEnvFile(text: string): GateConfig {
  const config: GateConfig = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const separator = trimmed.indexOf('=');
    if (separator <= 0) {
      continue;
    }
    const key = trimmed.slice(0, separator).trim();
    if (isFieldName(key)) {
      config[key] = trimmed.slice(separator + 1).trim();
    }
  }
  return config;
}

export function serializeEnvFile(config: GateConfig): string {
  const lines = [
    '# Written by gate-config. Read by the rally-gate-agent unit',
    '# via EnvironmentFile=. Edit through the gate config UI, or by hand while',
    '# gate-config is stopped.',
  ];
  for (const key of Object.keys(FIELDS) as FieldName[]) {
    const value = config[key];
    if (value !== undefined && value !== '') {
      lines.push(`${key}=${value}`);
    }
  }
  return lines.join('\n') + '\n';
}

export function readConfig(path = CONFIG_PATH): GateConfig {
  try {
    return parseEnvFile(readFileSync(path, 'utf8'));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return {};
    }
    throw err;
  }
}

/**
 * Written to a temporary file and renamed, never edited in place. rename(2) is
 * atomic within a filesystem, so a gate losing power mid-save — which happens,
 * it runs off a battery in a forest — leaves either the old config or the new
 * one, never half a line that systemd would then refuse to parse.
 */
export function writeConfig(config: GateConfig, path = CONFIG_PATH): void {
  const temporary = join(
    dirname(path),
    `.${randomBytes(6).toString('hex')}.tmp`,
  );
  try {
    writeFileSync(temporary, serializeEnvFile(config), { mode: 0o644 });
    renameSync(temporary, path);
  } catch (err) {
    try {
      unlinkSync(temporary);
    } catch {
      // Already gone, or never created — nothing to clean up either way.
    }
    throw err;
  }
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A key typo or a missing translation renders the raw key on screen, and
 * nothing else would notice. Keys are found as single-quoted dotted literals
 * ('live.startNow') and `keypath`s; double quotes are Vue expressions
 * (v-model="draft.body"), and keys built at runtime go unchecked.
 */
const root = join(import.meta.dirname, '..', '..', '..');
const ui = join(root, 'packages', 'ui', 'src');

type Messages = { [key: string]: string | Messages };

const flatten = (messages: Messages, prefix = ''): string[] =>
  Object.entries(messages).flatMap(([key, value]) =>
    typeof value === 'string'
      ? [prefix + key]
      : flatten(value, `${prefix}${key}.`),
  );

const load = (dir: string, locale: string): Set<string> =>
  new Set(
    flatten(
      JSON.parse(readFileSync(join(dir, 'locales', `${locale}.json`), 'utf8')),
    ),
  );

const sources = (dir: string): string[] =>
  readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((f) => /\.(ts|vue)$/.test(f) && !f.endsWith('.spec.ts'))
    .map((f) => readFileSync(join(dir, f), 'utf8'));

const KEY = /'([a-z][a-zA-Z]*(?:\.[a-zA-Z]+)+)'|keypath="([^"]+)"/g;

for (const app of [
  join(root, 'apps', 'web', 'src'),
  join(root, 'apps', 'gate-config', 'web', 'src'),
]) {
  const en = new Set([...load(app, 'en'), ...load(ui, 'en')]);
  const de = new Set([...load(app, 'de'), ...load(ui, 'de')]);

  test(`${app}: every key used exists in en`, () => {
    const used = new Set(
      [...sources(app), ...sources(ui)].flatMap((code) =>
        [...code.matchAll(KEY)].map((m) => m[1] ?? m[2]),
      ),
    );
    const notKeys = [...used].filter((k) => !en.has(k));
    assert.deepEqual(notKeys, []);
  });

  test(`${app}: every en key has a de translation`, () => {
    assert.deepEqual(
      [...en].filter((k) => !de.has(k)),
      [],
    );
  });
}

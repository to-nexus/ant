/**
 * en/ko key parity for `pipelines.json`. The inspector grew a batch of keys
 * per redesign; a key present in one locale only falls back to English (or the
 * raw key) in the other UI. Both files were in sync when this landed, so the
 * whole namespace is asserted — not a hand-listed subset that would drift.
 */

import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const LOCALES_DIR = path.resolve(__dirname, '../../src/i18n/locales');

function flatten(value: unknown, prefix = ''): string[] {
  if (value === null || typeof value !== 'object') return [prefix.slice(0, -1)];
  return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => flatten(v, `${prefix}${k}.`));
}

function keysOf(locale: string): Set<string> {
  return new Set(flatten(JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, locale, 'pipelines.json'), 'utf8'))));
}

describe('pipelines.json en/ko parity', () => {
  const en = keysOf('en');
  const ko = keysOf('ko');
  it('every en key exists in ko', () => {
    expect([...en].filter((k) => !ko.has(k))).toEqual([]);
  });
  it('every ko key exists in en', () => {
    expect([...ko].filter((k) => !en.has(k))).toEqual([]);
  });
});

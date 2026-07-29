/**
 * en/ko parity for the diagram-viewer strings in `common.json`.
 *
 * The sibling `locale-duplicate-keys` guard catches a key declared twice, but not a
 * key present in one locale and missing in the other — i18next then falls back and
 * silently shows English (or the raw key) in the Korean UI.
 *
 * Scoped to the `mermaid` group on purpose: an app-wide parity assertion cannot ship
 * today because `actions.json` carries 20 pre-existing ko-only paths, and fixing those
 * is unrelated to this surface.
 */

import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const LOCALES_DIR = path.resolve(__dirname, '../../src/i18n/locales');

function loadGroup(locale: string): Record<string, string> {
  const raw = fs.readFileSync(path.join(LOCALES_DIR, locale, 'common.json'), 'utf8');
  const parsed = JSON.parse(raw) as { mermaid?: Record<string, string> };
  expect(parsed.mermaid, `common.json (${locale}) is missing the "mermaid" group`).toBeDefined();
  return parsed.mermaid!;
}

const REQUIRED_KEYS = [
  'expand',
  'close',
  'zoomIn',
  'zoomOut',
  'reset',
  'actualSize',
  'hint',
  'rendering',
  'renderFailed',
] as const;

describe('common.json mermaid group', () => {
  const en = loadGroup('en');
  const ko = loadGroup('ko');

  it('declares the same leaf keys in both locales', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(ko).sort());
  });

  it('covers every key the viewer consumes', () => {
    for (const key of REQUIRED_KEYS) {
      expect(Object.keys(en)).toContain(key);
    }
  });

  it('has a non-empty translation for every key', () => {
    for (const [locale, group] of [
      ['en', en],
      ['ko', ko],
    ] as const) {
      for (const [key, value] of Object.entries(group)) {
        expect(typeof value, `${locale}.mermaid.${key}`).toBe('string');
        expect(value.trim().length, `${locale}.mermaid.${key} is empty`).toBeGreaterThan(0);
      }
    }
  });

  it('keeps the {{message}} placeholder in both locales', () => {
    expect(en.renderFailed).toContain('{{message}}');
    expect(ko.renderFailed).toContain('{{message}}');
  });

  it('is actually translated, not copied from English', () => {
    // `zoomIn`/`zoomOut` etc. could legitimately coincide, but the sentence-length
    // strings must differ or the group was pasted without translating.
    expect(ko.hint).not.toBe(en.hint);
    expect(ko.expand).not.toBe(en.expand);
  });
});

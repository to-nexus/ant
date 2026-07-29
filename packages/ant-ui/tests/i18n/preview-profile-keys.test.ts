/**
 * Locks the Project Profile card's i18n keys in BOTH locales.
 *
 * Three defects this guards:
 *   - `notDetected` read "감지되지 않음 (프리뷰를 시작하면 감지됩니다)" /
 *     "Not detected (start preview to detect)". Detection no longer depends on
 *     running a preview, so that sentence actively taught the wrong model.
 *   - `structureType` kept a trailing colon from the old label-value layout; it
 *     is now a standalone uppercased chip label.
 *   - `projectProfile` / `projectProfileDesc` / `language` / `framework` existed
 *     only as inline `t()` defaults, so the English UI rendered Korean.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const LOCALES = ['ko', 'en'] as const;
const REQUIRED = [
  'projectProfile',
  'projectProfileDesc',
  'structureType',
  'language',
  'framework',
  'notDetected',
] as const;

function previewSection(locale: string): Record<string, unknown> {
  const file = path.join(__dirname, '../../src/i18n/locales', locale, 'explorer.json');
  return JSON.parse(fs.readFileSync(file, 'utf-8')).preview;
}

describe.each(LOCALES)('explorer.json (%s) — preview profile keys', (locale) => {
  const preview = previewSection(locale);

  it.each(REQUIRED)('defines a non-empty preview.%s', (key) => {
    expect(typeof preview[key]).toBe('string');
    expect((preview[key] as string).trim().length).toBeGreaterThan(0);
  });

  it('structureType is a bare chip label (no trailing colon)', () => {
    expect(preview.structureType as string).not.toMatch(/:\s*$/);
  });

  it('notDetected does not claim a preview must be started', () => {
    const value = (preview.notDetected as string).toLowerCase();
    expect(value).not.toContain('프리뷰');
    expect(value).not.toContain('start preview');
  });
});

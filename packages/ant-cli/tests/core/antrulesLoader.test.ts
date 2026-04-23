/**
 * L1 — `codebase/ANTRULES.md` loader invariants.
 *
 * ANTRULES.md is the codebase-specific **deviation ledger** gated by the
 * 3-condition filter (see docs/architecture/35-codebase-meta-policy.md).
 * The loader:
 *   - returns `undefined` on missing / unreadable / empty-content file
 *   - caps content at 1500 chars with a truncation footer
 *   - trims surrounding whitespace
 *
 * Single-field contract: `string | undefined`. No parallel `has` boolean —
 * the template partial gates on `{{#if antrulesContent}}` so `undefined`
 * suppresses the block entirely.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  ANTRULES_MAX_CHARS,
  ANTRULES_RELATIVE_PATH,
  loadAntrules,
} from '../../src/core/artifact/antrules';

function makeTmpFeatureRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'antrules-loader-test-'));
  fs.mkdirSync(path.join(dir, 'codebase'), { recursive: true });
  return dir;
}

describe('loadAntrules', () => {
  let root: string;

  beforeEach(() => { root = makeTmpFeatureRoot(); });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  it('returns undefined when featureRoot is undefined', () => {
    expect(loadAntrules(undefined)).toBeUndefined();
  });

  it('returns undefined when the file does not exist', () => {
    expect(loadAntrules(root)).toBeUndefined();
  });

  it('returns undefined when the file is empty (trimmed length 0)', () => {
    fs.writeFileSync(path.join(root, ANTRULES_RELATIVE_PATH), '   \n\n  ');
    expect(loadAntrules(root)).toBeUndefined();
  });

  it('returns trimmed content for a small file', () => {
    const body = '# ANTRULES.md\n\n## Export Style\n- default export\n';
    fs.writeFileSync(path.join(root, ANTRULES_RELATIVE_PATH), `\n${body}\n`);
    expect(loadAntrules(root)).toBe(body.trim());
  });

  it('truncates content above the cap and appends a read_file pointer', () => {
    const huge = 'A'.repeat(ANTRULES_MAX_CHARS + 500);
    fs.writeFileSync(path.join(root, ANTRULES_RELATIVE_PATH), huge);
    const out = loadAntrules(root);
    expect(out).toBeDefined();
    // The prefix matches the original body up to the cap.
    expect(out!.startsWith('A'.repeat(ANTRULES_MAX_CHARS))).toBe(true);
    // The footer tells the LLM it is truncated and points at read_file.
    expect(out!).toMatch(/truncated/i);
    expect(out!).toMatch(/read_file.*codebase\/ANTRULES\.md/);
  });

  it('policy contract — canonical relative path', () => {
    expect(ANTRULES_RELATIVE_PATH).toBe('codebase/ANTRULES.md');
  });

  it('non-ANTRULES.md files in the codebase directory do not influence the loader', () => {
    fs.writeFileSync(path.join(root, 'codebase', 'README.md'), '# readme');
    fs.writeFileSync(path.join(root, 'codebase', 'docs.md'), 'docs');
    expect(loadAntrules(root)).toBeUndefined();
  });
});

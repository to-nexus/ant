/**
 * L1 — `codebase/ANT.md` loader invariants.
 *
 * ANT.md is the SSOT for ant-agent settings in a given codebase
 * (see docs/architecture/35-codebase-meta-policy.md). The loader:
 *   - returns { has:false } on missing / unreadable / empty-content file
 *   - caps content at 1500 chars with a truncation footer
 *   - trims surrounding whitespace
 *
 * These invariants are contract with the prompt partial
 * `jobs/code/base/injections/ant-md.md` which gates on `hasAntMd`
 * and renders `antMdContent` verbatim.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  ANT_MD_MAX_CHARS,
  ANT_MD_RELATIVE_PATH,
  loadAntMd,
  mergeAntMdVars,
} from '../../src/core/artifact/antMd';

function makeTmpFeatureRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-md-test-'));
  fs.mkdirSync(path.join(dir, 'codebase'), { recursive: true });
  return dir;
}

describe('loadAntMd', () => {
  let root: string;

  beforeEach(() => { root = makeTmpFeatureRoot(); });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  it('returns has=false when featureRoot is undefined', () => {
    expect(loadAntMd(undefined)).toEqual({ has: false, content: '', truncated: false });
  });

  it('returns has=false when the file does not exist', () => {
    expect(loadAntMd(root)).toEqual({ has: false, content: '', truncated: false });
  });

  it('returns has=false when the file is empty (trimmed length 0)', () => {
    fs.writeFileSync(path.join(root, ANT_MD_RELATIVE_PATH), '   \n\n  ');
    expect(loadAntMd(root)).toEqual({ has: false, content: '', truncated: false });
  });

  it('returns trimmed content with has=true for a small file', () => {
    const body = '# ANT.md\n\n## Export Style\n- default export\n';
    fs.writeFileSync(path.join(root, ANT_MD_RELATIVE_PATH), `\n${body}\n`);
    const result = loadAntMd(root);
    expect(result.has).toBe(true);
    expect(result.truncated).toBe(false);
    expect(result.content).toBe(body.trim());
  });

  it('truncates content above the cap and appends a read_file pointer', () => {
    const huge = 'A'.repeat(ANT_MD_MAX_CHARS + 500);
    fs.writeFileSync(path.join(root, ANT_MD_RELATIVE_PATH), huge);
    const result = loadAntMd(root);
    expect(result.has).toBe(true);
    expect(result.truncated).toBe(true);
    // The prefix matches the original body up to the cap.
    expect(result.content.startsWith('A'.repeat(ANT_MD_MAX_CHARS))).toBe(true);
    // The footer tells the LLM it is truncated and points at read_file.
    expect(result.content).toMatch(/truncated/i);
    expect(result.content).toMatch(/read_file.*codebase\/ANT\.md/);
  });

  it('policy contract — canonical relative path', () => {
    // The policy fixes the canonical name at `codebase/ANT.md`. Filesystem
    // case sensitivity depends on the underlying FS (APFS is case-insensitive
    // by default on macOS; Linux ext4 is case-sensitive), so we do NOT
    // assert "lowercase ant.md is rejected" here — that behaviour varies
    // by host. The constant itself is the policy SSOT.
    expect(ANT_MD_RELATIVE_PATH).toBe('codebase/ANT.md');
  });

  it('non-ANT.md files in the codebase directory do not influence the loader', () => {
    fs.writeFileSync(path.join(root, 'codebase', 'README.md'), '# readme');
    fs.writeFileSync(path.join(root, 'codebase', 'docs.md'), 'docs');
    expect(loadAntMd(root).has).toBe(false);
  });
});

describe('mergeAntMdVars', () => {
  it('adds hasAntMd + antMdContent to the vars object', () => {
    const out = mergeAntMdVars({ foo: 1 }, { has: true, content: 'x', truncated: false });
    expect(out).toEqual({ foo: 1, hasAntMd: true, antMdContent: 'x' });
  });

  it('does not clobber pre-existing hasAntMd / antMdContent keys', () => {
    const out = mergeAntMdVars(
      { hasAntMd: false, antMdContent: 'custom' },
      { has: true, content: 'from-disk', truncated: false },
    );
    expect(out.hasAntMd).toBe(false);
    expect(out.antMdContent).toBe('custom');
  });
});

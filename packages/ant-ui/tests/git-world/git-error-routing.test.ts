/**
 * Phase 5 F4 — `useGitErrorRouting` SSOT routing.
 *
 * The hook itself depends on react/i18n providers which are heavy to
 * stand up in vitest. The behavioural lock here is a SOURCE-LEVEL
 * regression guard: every PAT-class branch must go through the hook,
 * not via inline `kind === 'auth'` checks scattered across components.
 *
 * Allowlist:
 *   - The hook definition itself (`useGitErrorRouting.ts`) IS the inline
 *     branch, by construction.
 *
 * Anything else under `packages/ant-ui/src` containing inline
 * `kind === 'auth'` or `suggestedAction === 'configurePat'` is a
 * regression of the SSOT consolidation.
 */

import { describe, it, expect } from 'vitest';
import { readdir, readFile, stat } from 'fs/promises';
import * as path from 'path';

const SRC_ROOT = path.resolve(__dirname, '..', '..', 'src');
const ALLOW = [
  path.join(SRC_ROOT, 'application', 'hooks', 'git', 'useGitErrorRouting.ts'),
];
const PATTERN = /(kind\s*===\s*'auth'|suggestedAction\s*===\s*'configurePat')/;

async function walk(dir: string, out: string[] = []): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === 'dist' || e.name === '__tests__') continue;
      await walk(full, out);
    } else if (e.isFile() && /\.(ts|tsx)$/.test(e.name)) {
      out.push(full);
    }
  }
  return out;
}

describe('PAT auth routing SSOT', () => {
  it('useGitErrorRouting hook exists and contains the routing branch', async () => {
    const hookPath = path.join(SRC_ROOT, 'application', 'hooks', 'git', 'useGitErrorRouting.ts');
    const st = await stat(hookPath);
    expect(st.isFile()).toBe(true);
    const src = await readFile(hookPath, 'utf-8');
    expect(src).toMatch(/kind === 'auth'/);
    expect(src).toMatch(/configurePat/);
    expect(src).toMatch(/openMainPanelTab\('accountConfig'\)/);
  });

  it('no other source file uses inline auth-routing branches (consolidated through the hook)', async () => {
    const files = await walk(SRC_ROOT);
    const offenders: string[] = [];
    for (const f of files) {
      if (ALLOW.includes(f)) continue;
      const src = await readFile(f, 'utf-8');
      if (PATTERN.test(src)) offenders.push(path.relative(SRC_ROOT, f));
    }
    expect(offenders, `Inline PAT auth branches must route through useGitErrorRouting:\n${offenders.join('\n')}`).toEqual([]);
  });
});

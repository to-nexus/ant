/**
 * Git error presentation SSOT — `useGitErrorRouting`.
 *
 * The hook depends on react/i18n providers that are heavy to stand up in
 * vitest, so the behavioural lock here is a SOURCE-LEVEL regression guard.
 * Three invariants, each of which was violated once:
 *
 *  1. PAT-class branches live in the hook, not inline in components.
 *  2. No Git dispatch site formats an error itself. `showError(err.message)`
 *     is how raw `git push` stderr ("! [rejected] (fetch first)") reached a
 *     user-facing modal — the hook is TOTAL and owns every dialog.
 *  3. `fallback: 'none'` — the opt-out for a surface that owns its own error
 *     UI — is used only by the project wizard.
 */

import { describe, it, expect } from 'vitest';
import { readdir, readFile, stat } from 'fs/promises';
import * as path from 'path';

const SRC_ROOT = path.resolve(__dirname, '..', '..', 'src');
const HOOK = path.join(SRC_ROOT, 'application', 'hooks', 'git', 'useGitErrorRouting.tsx');
const ALLOW = [HOOK];
const PATTERN = /(kind\s*===\s*'auth'|suggestedAction\s*===\s*'configurePat')/;

/** A git dispatch site handing an error object straight to a dialog. */
const RAW_LEAK = /show(?:Error|Confirm|Warning|Info)\(.{0,160}error\??\.message/s;
/** Files that participate in git operations at all. */
const GIT_SURFACE = /runGitOperation|useGitErrorRouting/;

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

describe('Git error presentation SSOT', () => {
  it('the presenter hook exists and owns the routing branches', async () => {
    const st = await stat(HOOK);
    expect(st.isFile()).toBe(true);
    const src = await readFile(HOOK, 'utf-8');
    expect(src).toMatch(/kind === 'auth'/);
    expect(src).toMatch(/configurePat/);
    expect(src).toMatch(/openMainPanelTab\('accountConfig'\)/);
    // Every recovery affordance the BE can suggest has a branch here.
    for (const action of ['syncFirst', 'commitFirst', 'retryWithMerge', 'resolveConflict', 'runClone']) {
      expect(src).toMatch(new RegExp(`suggestedAction === '${action}'`));
    }
  });

  it('no other source file uses inline auth-routing branches', async () => {
    const files = await walk(SRC_ROOT);
    const offenders: string[] = [];
    for (const f of files) {
      if (ALLOW.includes(f)) continue;
      const src = await readFile(f, 'utf-8');
      if (PATTERN.test(src)) offenders.push(path.relative(SRC_ROOT, f));
    }
    expect(offenders, `Inline PAT auth branches must route through useGitErrorRouting`).toEqual([]);
  });

  it('no git dispatch site renders a raw error message itself', async () => {
    const files = await walk(SRC_ROOT);
    const offenders: string[] = [];
    for (const f of files) {
      if (ALLOW.includes(f)) continue;
      const src = await readFile(f, 'utf-8');
      if (GIT_SURFACE.test(src) && RAW_LEAK.test(src)) offenders.push(path.relative(SRC_ROOT, f));
    }
    expect(
      offenders,
      `Git failures must go to useGitErrorRouting — raw git stderr is never a dialog's primary text`,
    ).toEqual([]);
  });

  it("only the project wizard opts out with fallback: 'none'", async () => {
    const files = await walk(SRC_ROOT);
    const optOuts: string[] = [];
    for (const f of files) {
      if (ALLOW.includes(f)) continue; // the hook documents the opt-out it defines
      const src = await readFile(f, 'utf-8');
      if (/fallback:\s*'none'/.test(src)) optOuts.push(path.relative(SRC_ROOT, f));
    }
    expect(optOuts.sort()).toEqual([
      path.join('presentation', 'components', 'ProjectWizardModal', 'ProjectWizardModal.tsx'),
    ]);
  });
});

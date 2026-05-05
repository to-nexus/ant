/**
 * `worktreeValidityFailure` structured diagnostic logging contract.
 *
 * The plan adds telemetry so operators can correlate user-reported
 * "Initialize Repository" symptoms with the underlying scenario without
 * manual EFS inspection. This test locks the emit shape — `callSite`,
 * `reason`, `scenario`, `gitFile`, `gitdirContents` — across the 5
 * possible reason values and the 4 call sites.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import * as os from 'os';
import * as path from 'path';

import { logger } from '../../src/utils/logger';
import { emitWorktreeValidityFailure } from '../../src/periphery/adapters/http/services/GitService/worktree';
import { GitHelper } from '../../src/periphery/adapters/http/services/GitService/helper/GitHelper';

interface Fixture {
  base: string;
  mainGitDir: string;
  metaDir: string;
  featureCodebase: string;
}

function makeFixture(): Fixture {
  const base = mkdtempSync(path.join(os.tmpdir(), 'ant-diag-log-'));
  const mainCodebase = path.join(base, 'codebase');
  const mainGitDir = path.join(mainCodebase, '.git');
  const metaDir = path.join(mainGitDir, 'worktrees', 'codebase');
  const featureCodebase = path.join(base, 'features', 'feat', 'codebase');
  mkdirSync(mainGitDir, { recursive: true });
  mkdirSync(metaDir, { recursive: true });
  mkdirSync(featureCodebase, { recursive: true });
  return { base, mainGitDir, metaDir, featureCodebase };
}

describe('emitWorktreeValidityFailure — structured diagnostic emit', () => {
  let fx: Fixture;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fx = makeFixture();
    warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    rmSync(fx.base, { recursive: true, force: true });
    warnSpy.mockRestore();
  });

  function lastWarnCall(): { message: string; ctx: any; meta: any } {
    expect(warnSpy).toHaveBeenCalled();
    const calls = warnSpy.mock.calls;
    const last = calls[calls.length - 1];
    return { message: last[0] as string, ctx: last[1] as any, meta: last[2] as any };
  }

  it('valid input → no emit (defensive guard)', () => {
    emitWorktreeValidityFailure({
      callSite: 'createWorktree.preExisting',
      projectId: 'p', featureName: 'f',
      workspacePath: fx.featureCodebase,
      validity: { valid: true },
    });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('S1 (no-git-file) → emits scenario=S1-race-or-never-created', () => {
    emitWorktreeValidityFailure({
      callSite: 'ensureGitRepository.stage4',
      projectId: 'p', featureName: 'f',
      workspacePath: fx.featureCodebase, // no .git marker
      validity: { valid: false, reason: 'no-git-file' },
    });
    const call = lastWarnCall();
    expect(call.message).toBe('worktreeValidityFailure');
    expect(call.meta.scenario).toBe('S1-race-or-never-created');
    expect(call.meta.callSite).toBe('ensureGitRepository.stage4');
    expect(call.meta.reason).toBe('no-git-file');
    expect(call.meta.gitFile.exists).toBe(false);
  });

  it('S2 (head-missing) → emits scenario=S2-nfs-partial-write + gitFile content', () => {
    writeFileSync(path.join(fx.featureCodebase, '.git'), `gitdir: ${fx.metaDir}\n`, 'utf-8');
    writeFileSync(path.join(fx.metaDir, 'commondir'), '../..\n', 'utf-8');
    // HEAD intentionally missing → head-missing reason

    emitWorktreeValidityFailure({
      callSite: 'createWorktree.postCreate',
      projectId: 'p', featureName: 'f',
      workspacePath: fx.featureCodebase,
      validity: { valid: false, reason: 'head-missing' },
    });
    const call = lastWarnCall();
    expect(call.meta.scenario).toBe('S2-nfs-partial-write');
    expect(call.meta.gitFile.exists).toBe(true);
    expect(call.meta.gitFile.content).toContain('gitdir: ');
    expect(Array.isArray(call.meta.gitdirContents)).toBe(true);
    // commondir was written above; HEAD is missing
    expect(call.meta.gitdirContents).toContain('commondir');
    expect(call.meta.gitdirContents).not.toContain('HEAD');
  });

  it('S2 (commondir-missing) → also S2-nfs-partial-write', () => {
    writeFileSync(path.join(fx.featureCodebase, '.git'), `gitdir: ${fx.metaDir}\n`, 'utf-8');
    writeFileSync(path.join(fx.metaDir, 'HEAD'), 'ref: refs/heads/feat\n', 'utf-8');

    emitWorktreeValidityFailure({
      callSite: 'pruneCorruptWorktreeMeta',
      projectId: undefined, featureName: undefined,
      workspacePath: fx.featureCodebase,
      validity: { valid: false, reason: 'commondir-missing' },
    });
    const call = lastWarnCall();
    expect(call.meta.scenario).toBe('S2-nfs-partial-write');
    expect(call.meta.callSite).toBe('pruneCorruptWorktreeMeta');
  });

  it('S3 (gitdir-missing) → emits scenario=S3-stale-marker-from-previous-attempt', () => {
    const ghost = path.join(fx.mainGitDir, 'worktrees', 'ghost');
    writeFileSync(path.join(fx.featureCodebase, '.git'), `gitdir: ${ghost}\n`, 'utf-8');
    emitWorktreeValidityFailure({
      callSite: 'StatusService.autoRecover',
      projectId: 'p', featureName: 'f',
      workspacePath: fx.featureCodebase,
      validity: { valid: false, reason: 'gitdir-missing' },
    });
    const call = lastWarnCall();
    expect(call.meta.scenario).toBe('S3-stale-marker-from-previous-attempt');
  });

  it('S4 (invalid-marker) → emits scenario=S4-corrupt-marker', () => {
    writeFileSync(path.join(fx.featureCodebase, '.git'), 'totally not a gitdir line\n', 'utf-8');
    emitWorktreeValidityFailure({
      callSite: 'createWorktree.preExisting',
      projectId: 'p', featureName: 'f',
      workspacePath: fx.featureCodebase,
      validity: { valid: false, reason: 'invalid-marker' },
    });
    const call = lastWarnCall();
    expect(call.meta.scenario).toBe('S4-corrupt-marker');
    expect(call.meta.gitFile.content).toBe('totally not a gitdir line');
  });

  it('all 4 callSites accepted by type system', () => {
    // Compile-time check: this would fail to compile if the union changed.
    // Runtime: just verify each emit succeeds without throwing.
    const sites = [
      'createWorktree.preExisting',
      'createWorktree.postCreate',
      'pruneCorruptWorktreeMeta',
      'ensureGitRepository.stage4',
      'StatusService.autoRecover',
    ] as const;
    for (const site of sites) {
      emitWorktreeValidityFailure({
        callSite: site,
        projectId: 'p', featureName: 'f',
        workspacePath: fx.featureCodebase,
        validity: { valid: false, reason: 'no-git-file' },
      });
    }
    expect(warnSpy.mock.calls.length).toBe(sites.length);
  });

  it('GitHelper.isWorktreeStructureValid result feeds into emit (round-trip)', () => {
    // The validity helper produces the exact reason that the emit dispatches.
    const validity = GitHelper.isWorktreeStructureValid(fx.featureCodebase);
    expect(validity).toEqual({ valid: false, reason: 'no-git-file' });
    emitWorktreeValidityFailure({
      callSite: 'createWorktree.preExisting',
      projectId: 'p', featureName: 'f',
      workspacePath: fx.featureCodebase,
      validity,
    });
    const call = lastWarnCall();
    expect(call.meta.reason).toBe('no-git-file');
    expect(call.meta.scenario).toBe('S1-race-or-never-created');
  });
});

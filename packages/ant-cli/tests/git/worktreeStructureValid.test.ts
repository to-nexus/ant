/**
 * `GitHelper.isWorktreeStructureValid` 6 scenario lock.
 *
 * SSOT for worktree validity (4-stage check). Replaces the inline
 * `fs.existsSync(gitdirAbs)` checks scattered across:
 * - `WorktreeService.createWorktree` (early-return + post-create probe)
 * - `WorktreeService.pruneCorruptWorktreeMeta` (orphan detection)
 * - `ensureGitRepository` (Stage-4 self-heal trigger)
 * - `StatusService.getGitChanges` (defense-in-depth diagnostic)
 *
 * Locks the union of failure modes that produce user-visible "Initialize
 * Repository" symptoms in the IDE.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import * as os from 'os';
import * as path from 'path';

import { GitHelper } from '../../src/periphery/adapters/http/services/GitService/helper/GitHelper';

interface Fixture {
  base: string;
  mainCodebase: string;
  mainGitDir: string;
  metaDir: string;
  featureCodebase: string;
}

function makeFixture(): Fixture {
  const base = mkdtempSync(path.join(os.tmpdir(), 'ant-validity-'));
  const mainCodebase = path.join(base, 'main', 'codebase');
  const mainGitDir = path.join(mainCodebase, '.git');
  const metaDir = path.join(mainGitDir, 'worktrees', 'codebase');
  const featureCodebase = path.join(base, 'main', 'features', 'feat-x', 'codebase');
  mkdirSync(mainGitDir, { recursive: true });
  mkdirSync(metaDir, { recursive: true });
  mkdirSync(featureCodebase, { recursive: true });
  return { base, mainCodebase, mainGitDir, metaDir, featureCodebase };
}

function writeMarker(fx: Fixture, gitdirAbs: string = fx.metaDir): void {
  writeFileSync(path.join(fx.featureCodebase, '.git'), `gitdir: ${gitdirAbs}\n`, 'utf-8');
}

function writeMeta(fx: Fixture, opts: { head?: boolean; commondir?: boolean } = {}): void {
  if (opts.head) writeFileSync(path.join(fx.metaDir, 'HEAD'), 'ref: refs/heads/feat-x\n', 'utf-8');
  if (opts.commondir) writeFileSync(path.join(fx.metaDir, 'commondir'), '../..\n', 'utf-8');
}

describe('GitHelper.isWorktreeStructureValid', () => {
  let fx: Fixture;

  beforeEach(() => { fx = makeFixture(); });
  afterEach(() => { rmSync(fx.base, { recursive: true, force: true }); });

  it('S1 — `.git` marker missing → no-git-file', () => {
    // No marker written; meta dir intentionally has HEAD/commondir to
    // prove the failure is on the worktree side, not the meta side.
    writeMeta(fx, { head: true, commondir: true });
    const result = GitHelper.isWorktreeStructureValid(fx.featureCodebase);
    expect(result).toEqual({ valid: false, reason: 'no-git-file' });
  });

  it('S4 — `.git` marker malformed → invalid-marker', () => {
    writeFileSync(path.join(fx.featureCodebase, '.git'), 'totally not a gitdir line\n', 'utf-8');
    writeMeta(fx, { head: true, commondir: true });
    const result = GitHelper.isWorktreeStructureValid(fx.featureCodebase);
    expect(result).toEqual({ valid: false, reason: 'invalid-marker' });
  });

  it('S3 — marker references missing meta directory → gitdir-missing', () => {
    const ghostMeta = path.join(fx.mainGitDir, 'worktrees', 'ghost');
    writeMarker(fx, ghostMeta);
    const result = GitHelper.isWorktreeStructureValid(fx.featureCodebase);
    expect(result).toEqual({ valid: false, reason: 'gitdir-missing' });
  });

  it('S2a — meta exists but HEAD missing (NFS partial write) → head-missing', () => {
    writeMarker(fx);
    writeMeta(fx, { commondir: true }); // HEAD intentionally absent
    const result = GitHelper.isWorktreeStructureValid(fx.featureCodebase);
    expect(result).toEqual({ valid: false, reason: 'head-missing' });
  });

  it('S2b — meta exists with HEAD but commondir missing → commondir-missing', () => {
    writeMarker(fx);
    writeMeta(fx, { head: true }); // commondir intentionally absent
    const result = GitHelper.isWorktreeStructureValid(fx.featureCodebase);
    expect(result).toEqual({ valid: false, reason: 'commondir-missing' });
  });

  it('valid — all four stages pass', () => {
    writeMarker(fx);
    writeMeta(fx, { head: true, commondir: true });
    const result = GitHelper.isWorktreeStructureValid(fx.featureCodebase);
    expect(result).toEqual({ valid: true });
  });

  it('main repo (`.git` is a directory) → reports valid (worktree validity is per-feature only)', () => {
    // mainCodebase has .git as a directory (created by makeFixture).
    const result = GitHelper.isWorktreeStructureValid(fx.mainCodebase);
    expect(result).toEqual({ valid: true });
  });
});

describe('GitHelper.resolveWorktreeAbsPaths (SSOT used by both Docker bind + K8s mount)', () => {
  let fx: Fixture;
  beforeEach(() => { fx = makeFixture(); });
  afterEach(() => { rmSync(fx.base, { recursive: true, force: true }); });

  it('returns null for missing marker', () => {
    expect(GitHelper.resolveWorktreeAbsPaths(fx.featureCodebase)).toBeNull();
  });

  it('returns null for `.git` directory (base case)', () => {
    expect(GitHelper.resolveWorktreeAbsPaths(fx.mainCodebase)).toBeNull();
  });

  it('returns null when mainGitDir does not exist on disk', () => {
    const ghost = path.join(fx.base, 'no-such-main', '.git', 'worktrees', 'feat-x');
    writeMarker(fx, ghost);
    expect(GitHelper.resolveWorktreeAbsPaths(fx.featureCodebase)).toBeNull();
  });

  it('returns mainGitDir + worktreePath for a valid marker', () => {
    writeMarker(fx);
    const abs = GitHelper.resolveWorktreeAbsPaths(fx.featureCodebase);
    expect(abs).toEqual({
      mainGitDir: fx.mainGitDir,
      worktreePath: fx.featureCodebase,
    });
  });
});

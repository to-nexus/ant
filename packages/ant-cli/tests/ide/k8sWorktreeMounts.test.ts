/**
 * Phase 1 regression — `resolveK8sWorktreeMounts` SSOT contract.
 *
 * Locks the alias-model topology that mirrors Docker's
 * `GitHelper.resolveWorktreeBindMounts`:
 *   - base (`.git` is a directory) -> []
 *   - worktree (`.git` is a file with valid `gitdir:`) -> [mainGitDir, worktreePath]
 *   - corrupt marker / missing main .git -> [] + warn
 *   - dedup-collision: workspacePath / mainGitDir / worktreePath all distinct
 *     mountPaths so K8s never rejects the spec with `mountPath: must be unique`.
 *   - WORKSPACE_BASE_PATH mismatch -> throw (silent broken pod prevention).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  resolveK8sWorktreeMounts,
  type K8sWorktreeMount,
} from '../../src/infrastructure/ide/k8sWorktreeMounts';

interface Fixture {
  base: string;
  projectDir: string;
  mainCodebase: string;
  mainGitDir: string;
  featureCodebase: string;
}

function makeFixture(): Fixture {
  const base = mkdtempSync(path.join(os.tmpdir(), 'ant-k8s-mounts-'));
  const projectDir = path.join(base, 'org', 'user', 'proj');
  const mainCodebase = path.join(projectDir, 'codebase');
  const mainGitDir = path.join(mainCodebase, '.git');
  const featureCodebase = path.join(projectDir, 'features', 'feat-x', 'codebase');
  mkdirSync(mainCodebase, { recursive: true });
  mkdirSync(mainGitDir, { recursive: true });
  mkdirSync(path.join(mainGitDir, 'worktrees', 'feat-x'), { recursive: true });
  mkdirSync(featureCodebase, { recursive: true });
  return { base, projectDir, mainCodebase, mainGitDir, featureCodebase };
}

describe('resolveK8sWorktreeMounts', () => {
  let fx: Fixture;

  beforeEach(() => {
    fx = makeFixture();
  });

  afterEach(() => {
    rmSync(fx.base, { recursive: true, force: true });
  });

  it('returns [] when .git is a real directory (base branch)', () => {
    const result = resolveK8sWorktreeMounts(fx.mainCodebase, fx.base);
    expect(result).toEqual([]);
  });

  it('returns mainGitDir + worktreePath mounts for a valid worktree marker', () => {
    const gitFile = path.join(fx.featureCodebase, '.git');
    const gitdirAbs = path.join(fx.mainGitDir, 'worktrees', 'feat-x');
    writeFileSync(gitFile, `gitdir: ${gitdirAbs}\n`, 'utf-8');

    const result = resolveK8sWorktreeMounts(fx.featureCodebase, fx.base);

    expect(result).toHaveLength(2);
    const byMountPath = new Map(result.map((m) => [m.mountPath, m]));
    expect(byMountPath.has(fx.mainGitDir)).toBe(true);
    expect(byMountPath.has(fx.featureCodebase)).toBe(true);
    // subPaths are PVC-relative
    expect(byMountPath.get(fx.mainGitDir)!.subPath).toBe(
      path.relative(fx.base, fx.mainGitDir).replace(/^\/+/, ''),
    );
    expect(byMountPath.get(fx.featureCodebase)!.subPath).toBe(
      path.relative(fx.base, fx.featureCodebase).replace(/^\/+/, ''),
    );
  });

  it('returns [] when gitdir format is corrupt', () => {
    const gitFile = path.join(fx.featureCodebase, '.git');
    writeFileSync(gitFile, 'totally not a gitdir line\n', 'utf-8');

    const result = resolveK8sWorktreeMounts(fx.featureCodebase, fx.base);

    expect(result).toEqual([]);
  });

  it('returns [] when mainGitDir referenced by gitdir does not exist', () => {
    const gitFile = path.join(fx.featureCodebase, '.git');
    const bogusGitdir = path.join(fx.base, 'nonexistent', '.git', 'worktrees', 'feat-x');
    writeFileSync(gitFile, `gitdir: ${bogusGitdir}\n`, 'utf-8');

    const result = resolveK8sWorktreeMounts(fx.featureCodebase, fx.base);

    expect(result).toEqual([]);
  });

  it('dedup-collision: alias /workspace + helper entries form 3 distinct mountPaths', () => {
    const gitFile = path.join(fx.featureCodebase, '.git');
    const gitdirAbs = path.join(fx.mainGitDir, 'worktrees', 'feat-x');
    writeFileSync(gitFile, `gitdir: ${gitdirAbs}\n`, 'utf-8');

    const helperResult = resolveK8sWorktreeMounts(fx.featureCodebase, fx.base);
    // Compose the full pod volumeMounts the way createPodSpec does.
    const podMounts: K8sWorktreeMount[] = [
      { name: 'workspace', mountPath: '/workspace', subPath: 'org/user/proj/features/feat-x/codebase' },
      ...helperResult,
    ];
    const mountPaths = podMounts.map((m) => m.mountPath);
    const unique = new Set(mountPaths);
    expect(unique.size).toBe(mountPaths.length);
    expect(unique.size).toBe(3);
    expect(unique.has('/workspace')).toBe(true);
    expect(unique.has(fx.mainGitDir)).toBe(true);
    expect(unique.has(fx.featureCodebase)).toBe(true);
  });

  it('throws when a returned mountPath would be outside workspaceBasePath (silent broken pod prevention)', () => {
    const outsideMain = mkdtempSync(path.join(os.tmpdir(), 'ant-outside-'));
    const outsideGitDir = path.join(outsideMain, '.git');
    mkdirSync(path.join(outsideGitDir, 'worktrees', 'feat-x'), { recursive: true });
    const gitFile = path.join(fx.featureCodebase, '.git');
    writeFileSync(gitFile, `gitdir: ${path.join(outsideGitDir, 'worktrees', 'feat-x')}\n`, 'utf-8');

    expect(() => resolveK8sWorktreeMounts(fx.featureCodebase, fx.base)).toThrow(
      /outside ANT_WORKSPACE_BASE_PATH/,
    );

    rmSync(outsideMain, { recursive: true, force: true });
  });
});

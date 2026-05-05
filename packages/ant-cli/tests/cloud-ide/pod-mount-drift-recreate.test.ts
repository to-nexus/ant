/**
 * `KubernetesIDEOrchestrator.hasMountDrift` regression — auto-recreate stale
 * pods whose `volumeMounts.length` no longer matches what
 * `resolveK8sWorktreeMounts` would produce now.
 *
 * Why this exists: `KubernetesIDEOrchestrator.start` reuses Running pods.
 * Pre-fix, a pod created during a worktree race (1-mount only) would be
 * reused forever after the worktree was self-healed (3 mounts expected),
 * leaving the user with `/mnt/` empty inside the IDE pod. This test locks
 * the drift detection so reuse only happens when mounts actually match.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import * as os from 'os';
import * as path from 'path';

import { KubernetesIDEOrchestrator } from '../../src/infrastructure/ide/KubernetesIDEOrchestrator';
import type { StateStorePort } from '../../src/core/ports/stateStore';

interface Fixture {
  base: string;
  mainCodebase: string;
  mainGitDir: string;
  featureCodebase: string;
}

function makeFixture(): Fixture {
  const base = mkdtempSync(path.join(os.tmpdir(), 'ant-mount-drift-'));
  const mainCodebase = path.join(base, 'org', 'user', 'proj', 'codebase');
  const mainGitDir = path.join(mainCodebase, '.git');
  const featureCodebase = path.join(base, 'org', 'user', 'proj', 'features', 'feat-x', 'codebase');
  mkdirSync(mainCodebase, { recursive: true });
  mkdirSync(mainGitDir, { recursive: true });
  mkdirSync(path.join(mainGitDir, 'worktrees', 'feat-x'), { recursive: true });
  mkdirSync(featureCodebase, { recursive: true });
  return { base, mainCodebase, mainGitDir, featureCodebase };
}

const stubStateStore = {} as unknown as StateStorePort;

function makeOrch(): KubernetesIDEOrchestrator {
  return new KubernetesIDEOrchestrator({}, stubStateStore);
}

const fakePod = (mountCount: number) => ({
  metadata: { name: 'fake', namespace: 'ax-ant-dev' },
  status: { phase: 'Running' },
  spec: {
    containers: [{
      name: 'openvscode-server',
      image: '',
      volumeMounts: Array.from({ length: mountCount }, (_, i) => ({
        name: 'workspace', mountPath: `/m${i}`, subPath: `s${i}`,
      })),
    }],
    volumes: [],
  },
});

describe('KubernetesIDEOrchestrator.hasMountDrift', () => {
  let fx: Fixture;
  let originalBase: string | undefined;

  beforeEach(() => {
    fx = makeFixture();
    originalBase = process.env.ANT_WORKSPACE_BASE_PATH;
    process.env.ANT_WORKSPACE_BASE_PATH = fx.base;
  });
  afterEach(() => {
    rmSync(fx.base, { recursive: true, force: true });
    if (originalBase === undefined) delete process.env.ANT_WORKSPACE_BASE_PATH;
    else process.env.ANT_WORKSPACE_BASE_PATH = originalBase;
  });

  it('stale 1-mount worktree pod (race remnant) → drift detected', () => {
    // Worktree marker is now valid → expects 3 mounts.
    writeFileSync(
      path.join(fx.featureCodebase, '.git'),
      `gitdir: ${path.join(fx.mainGitDir, 'worktrees', 'feat-x')}\n`,
      'utf-8',
    );
    const pod = fakePod(1);  // pod has only the alias mount (race-failure remnant)
    const drift = (makeOrch() as any).hasMountDrift(pod, fx.featureCodebase, 'feat-x');
    expect(drift).toBe(true);
  });

  it('valid 3-mount worktree pod → no drift, reuse', () => {
    writeFileSync(
      path.join(fx.featureCodebase, '.git'),
      `gitdir: ${path.join(fx.mainGitDir, 'worktrees', 'feat-x')}\n`,
      'utf-8',
    );
    const pod = fakePod(3);  // alias + mainGitDir + worktreePath
    const drift = (makeOrch() as any).hasMountDrift(pod, fx.featureCodebase, 'feat-x');
    expect(drift).toBe(false);
  });

  it('base pod with 1 mount + base feature → no drift, reuse', () => {
    // Base case: no .git marker on featureCodebase, but workspacePath here is
    // mainCodebase (where .git is a directory). resolveK8sWorktreeMounts → [].
    const pod = fakePod(1);
    const drift = (makeOrch() as any).hasMountDrift(pod, fx.mainCodebase, '_base');
    expect(drift).toBe(false);
  });

  it('malformed pod spec (no containers / 0 mounts) → drift (broken pod, recreate)', () => {
    // Optional-chaining yields actualCount=0 instead of throwing, which
    // legitimately differs from the expected base-pod count of 1. Treating
    // this as drift is correct — the pod is unusable and should be recreated.
    const malformed = { metadata: { name: 'x' }, spec: { containers: [], volumes: [] } } as any;
    const drift = (makeOrch() as any).hasMountDrift(malformed, fx.mainCodebase, '_base');
    expect(drift).toBe(true);
  });
});

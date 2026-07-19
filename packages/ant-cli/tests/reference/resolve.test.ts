/**
 * resolveReferenceCodebase — feature-worktree dir-mode vs bare-anchor git-mode,
 * branchBase pointer, plus tenant membership + self-reference enforcement.
 *
 * New model: git anchor = {project}/repo.git (hidden bare repo); every feature
 * is a worktree at {project}/features/{name}/codebase whose branch name IS the
 * feature name (no `feature/` prefix). There is no {project}/codebase main
 * worktree. `branchBase` (config.json) points at one of the features and
 * defaults to 'main'.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { UnifiedWorkspaceResolver } from '../../src/core/config/WorkspacePathResolver';
import {
  resolveReferenceCodebase,
  ReferenceTargetError,
} from '../../src/agents/common/tool/reference/resolve';

const uc = { userId: 'u', organizationId: 'o' };
let base: string;
let wr: UnifiedWorkspaceResolver;

beforeAll(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'ref-resolve-'));
  // tenant workspace: {base}/o/u/{project}
  const be = path.join(base, 'o', 'u', 'be');
  fs.mkdirSync(path.join(be, 'features', 'main', 'codebase'), { recursive: true });
  fs.mkdirSync(path.join(be, 'features', 'dev', 'codebase'), { recursive: true });
  // project whose branchBase points at a non-'main' feature
  const svc = path.join(base, 'o', 'u', 'svc');
  fs.mkdirSync(path.join(svc, 'features', 'dev', 'codebase'), { recursive: true });
  fs.writeFileSync(path.join(svc, 'config.json'), JSON.stringify({ branchBase: 'dev' }));
  // project with no materialized features at all (git anchor only)
  fs.mkdirSync(path.join(base, 'o', 'u', 'bare'), { recursive: true });
  fs.mkdirSync(path.join(base, 'o', 'u', 'app', 'features', 'main', 'codebase'), {
    recursive: true,
  });
  wr = new UnifiedWorkspaceResolver(base);
});

afterAll(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

describe('resolveReferenceCodebase', () => {
  it('resolves the default branchBase feature "main" (dir-mode) when no branch', async () => {
    const r = await resolveReferenceCodebase(wr, uc, { project: 'be' });
    expect(r.mode).toBe('dir');
    if (r.mode === 'dir') {
      expect(r.absPath).toBe(path.join(base, 'o', 'u', 'be', 'features', 'main', 'codebase'));
      expect(r.branch).toBeUndefined();
    }
  });

  it('follows the branchBase config pointer when no branch', async () => {
    const r = await resolveReferenceCodebase(wr, uc, { project: 'svc' });
    expect(r.mode).toBe('dir');
    if (r.mode === 'dir') {
      expect(r.absPath).toBe(path.join(base, 'o', 'u', 'svc', 'features', 'dev', 'codebase'));
    }
  });

  it('resolves an on-disk feature worktree (dir-mode) — branch name verbatim', async () => {
    const r = await resolveReferenceCodebase(wr, uc, { project: 'be', branch: 'dev' });
    expect(r.mode).toBe('dir');
    if (r.mode === 'dir') {
      expect(r.absPath).toBe(path.join(base, 'o', 'u', 'be', 'features', 'dev', 'codebase'));
      expect(r.branch).toBe('dev');
    }
  });

  it('resolves branch "main" to the feature dir named "main" (no alias handling)', async () => {
    const r = await resolveReferenceCodebase(wr, uc, { project: 'be', branch: 'main' });
    expect(r.mode).toBe('dir');
    if (r.mode === 'dir') {
      expect(r.absPath).toBe(path.join(base, 'o', 'u', 'be', 'features', 'main', 'codebase'));
    }
  });

  it('does NOT strip a feature/ prefix — such a branch falls to git-mode', async () => {
    const r = await resolveReferenceCodebase(wr, uc, { project: 'be', branch: 'feature/dev' });
    expect(r.mode).toBe('git');
    if (r.mode === 'git') expect(r.ref).toBe('feature/dev');
  });

  it('falls back to git-mode against the bare anchor for a branch not on disk', async () => {
    const r = await resolveReferenceCodebase(wr, uc, { project: 'be', branch: 'staging' });
    expect(r.mode).toBe('git');
    if (r.mode === 'git') {
      expect(r.gitDir).toBe(path.join(base, 'o', 'u', 'be', 'repo.git'));
      expect(r.ref).toBe('staging');
      expect(r.branch).toBe('staging');
    }
  });

  it('falls back to git-mode when the branchBase feature is not materialized', async () => {
    const r = await resolveReferenceCodebase(wr, uc, { project: 'bare' });
    expect(r.mode).toBe('git');
    if (r.mode === 'git') {
      expect(r.gitDir).toBe(path.join(base, 'o', 'u', 'bare', 'repo.git'));
      expect(r.ref).toBe('main');
      expect(r.branch).toBeUndefined();
    }
  });

  it('rejects a project outside the tenant workspace', async () => {
    await expect(
      resolveReferenceCodebase(wr, uc, { project: 'other-tenant-proj' }),
    ).rejects.toBeInstanceOf(ReferenceTargetError);
  });

  it('rejects the current project (self-reference guard)', async () => {
    await expect(
      resolveReferenceCodebase(wr, uc, { project: 'be' }, 'be'),
    ).rejects.toBeInstanceOf(ReferenceTargetError);
  });
});

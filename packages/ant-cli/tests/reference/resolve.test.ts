/**
 * resolveReferenceCodebase — dir-mode (main / feature) vs git-mode, plus tenant
 * membership enforcement.
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
  fs.mkdirSync(path.join(be, 'codebase'), { recursive: true });
  fs.mkdirSync(path.join(be, 'features', 'dev', 'codebase'), { recursive: true });
  fs.mkdirSync(path.join(base, 'o', 'u', 'app', 'codebase'), { recursive: true });
  wr = new UnifiedWorkspaceResolver(base);
});

afterAll(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

describe('resolveReferenceCodebase', () => {
  it('resolves main codebase (dir-mode) when no branch', async () => {
    const r = await resolveReferenceCodebase(wr, uc, { project: 'be' });
    expect(r.mode).toBe('dir');
    if (r.mode === 'dir') expect(r.absPath).toBe(path.join(base, 'o', 'u', 'be', 'codebase'));
  });

  it('resolves an on-disk feature worktree (dir-mode)', async () => {
    const r = await resolveReferenceCodebase(wr, uc, { project: 'be', branch: 'feature/dev' });
    expect(r.mode).toBe('dir');
    if (r.mode === 'dir') {
      expect(r.absPath).toBe(path.join(base, 'o', 'u', 'be', 'features', 'dev', 'codebase'));
    }
  });

  it('falls back to git-mode for a branch not materialized on disk', async () => {
    const r = await resolveReferenceCodebase(wr, uc, { project: 'be', branch: 'staging' });
    expect(r.mode).toBe('git');
    if (r.mode === 'git') expect(r.ref).toBe('staging');
  });

  it('rejects a project outside the tenant workspace', async () => {
    await expect(
      resolveReferenceCodebase(wr, uc, { project: 'other-tenant-proj' }),
    ).rejects.toBeInstanceOf(ReferenceTargetError);
  });
});

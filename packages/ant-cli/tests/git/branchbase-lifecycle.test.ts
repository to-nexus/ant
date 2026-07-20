/**
 * branchBase lifecycle SSOT — pointer semantics over the bare anchor.
 *
 * - feature count 0→1 auto-sets branchBase (+ anchor HEAD symref)
 * - deleting the base feature reassigns to the oldest remaining feature,
 *   or 'main' when none remain
 * - manual set validates existing-feature + not-remote-locked
 * - remote lock (origin present) freezes the pointer
 *
 * Real git + real fs (temp dirs).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import {
  applyAfterFeatureCreate,
  applyAfterRemoteConverge,
  applyBeforeBaseFeatureDelete,
  setBranchBaseManual,
  isBranchBaseLocked,
  readBranchBase,
  listFeatureDirsByCreation,
  type BranchBaseContext,
} from '../../src/periphery/adapters/http/services/GitService/anchor/branchBaseLifecycle';
import { gitAnchor } from '../../src/periphery/adapters/http/services/GitService/anchor/GitAnchorSSOT';
import { featureNameToSlug } from '@ant/shared';

const uc = { userId: 'u', organizationId: 'o' };

let projectPath: string;
let anchorPath: string;
let ctx: BranchBaseContext;

function mkFeature(name: string): void {
  // On disk a feature is a single slug segment (a name may contain `/`).
  fs.mkdirSync(path.join(projectPath, 'features', featureNameToSlug(name), 'codebase'), {
    recursive: true,
  });
}

function writeConfig(config: Record<string, unknown>): void {
  fs.writeFileSync(path.join(projectPath, 'config.json'), JSON.stringify(config), 'utf-8');
}

beforeEach(async () => {
  projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-branchbase-'));
  anchorPath = path.join(projectPath, 'repo.git');
  ctx = { projectId: 'p', projectPath, anchorPath, userContext: uc };
  writeConfig({});
});

afterEach(() => {
  fs.rmSync(projectPath, { recursive: true, force: true });
});

describe('branchBase lifecycle', () => {
  it('defaults to main with no config', () => {
    expect(readBranchBase(projectPath)).toBe('main');
  });

  it('0→1 feature auto-sets branchBase + anchor HEAD', async () => {
    await gitAnchor.ensureAnchor({ projectId: 'p', anchorPath, branchBase: 'main', userContext: uc });
    mkFeature('login');
    await applyAfterFeatureCreate(ctx, 'login');

    expect(readBranchBase(projectPath)).toBe('login');
    expect(await gitAnchor.readHeadBranch(anchorPath)).toBe('login');
  });

  it('second feature does NOT move the pointer', async () => {
    mkFeature('login');
    await applyAfterFeatureCreate(ctx, 'login');
    mkFeature('checkout');
    await applyAfterFeatureCreate(ctx, 'checkout');

    expect(readBranchBase(projectPath)).toBe('login');
  });

  it('deleting the base feature reassigns to the oldest remaining feature', async () => {
    mkFeature('login');
    await applyAfterFeatureCreate(ctx, 'login');
    // ensure distinct dir timestamps for creation ordering
    await new Promise((r) => setTimeout(r, 20));
    mkFeature('checkout');
    await new Promise((r) => setTimeout(r, 20));
    mkFeature('admin');

    fs.rmSync(path.join(projectPath, 'features', 'login'), { recursive: true });
    const next = await applyBeforeBaseFeatureDelete(ctx, 'login');

    expect(next).toBe('checkout');
    expect(readBranchBase(projectPath)).toBe('checkout');
  });

  it('deleting the LAST feature falls back to main', async () => {
    mkFeature('solo');
    await applyAfterFeatureCreate(ctx, 'solo');
    fs.rmSync(path.join(projectPath, 'features', 'solo'), { recursive: true });

    const next = await applyBeforeBaseFeatureDelete(ctx, 'solo');
    expect(next).toBe('main');
    expect(readBranchBase(projectPath)).toBe('main');
  });

  it('deleting a NON-base feature never touches the pointer', async () => {
    mkFeature('login');
    await applyAfterFeatureCreate(ctx, 'login');
    mkFeature('other');

    const next = await applyBeforeBaseFeatureDelete(ctx, 'other');
    expect(next).toBe('login');
    expect(readBranchBase(projectPath)).toBe('login');
  });

  it('manual set requires an existing feature', async () => {
    mkFeature('login');
    await expect(setBranchBaseManual(ctx, 'ghost')).rejects.toThrow(/existing feature/i);
    await setBranchBaseManual(ctx, 'login');
    expect(readBranchBase(projectPath)).toBe('login');
  });

  it('manual set rejects invalid names', async () => {
    // `feat/x` is now a valid name; use a genuinely-illegal one.
    await expect(setBranchBaseManual(ctx, 'a//b')).rejects.toThrow(/invalid/i);
  });

  it('slash feature: dir is the slug, pointer holds the raw name', async () => {
    mkFeature('release/1.0');
    // on-disk dir is the slug…
    expect(fs.existsSync(path.join(projectPath, 'features', 'release~1.0', 'codebase'))).toBe(true);
    // …but enumeration and the pointer speak the raw name.
    const listed = await listFeatureDirsByCreation(projectPath);
    expect(listed.map((f) => f.name)).toContain('release/1.0');
    await applyAfterFeatureCreate(ctx, 'release/1.0');
    expect(readBranchBase(projectPath)).toBe('release/1.0');
    await setBranchBaseManual(ctx, 'release/1.0');
    expect(readBranchBase(projectPath)).toBe('release/1.0');
  });

  it('remote lock freezes the pointer (manual set + delete reassignment)', async () => {
    await gitAnchor.ensureAnchor({ projectId: 'p', anchorPath, branchBase: 'main', userContext: uc });
    execFileSync('git', ['--git-dir', anchorPath, 'remote', 'add', 'origin', 'https://example.invalid/repo.git']);
    expect(await isBranchBaseLocked(anchorPath)).toBe(true);

    mkFeature('main');
    writeConfig({ branchBase: 'main' });

    await expect(setBranchBaseManual(ctx, 'main')).rejects.toThrow(/locked/i);

    // locked delete keeps the pointer (remote HEAD symmetry)
    fs.rmSync(path.join(projectPath, 'features', 'main'), { recursive: true });
    const next = await applyBeforeBaseFeatureDelete(ctx, 'main');
    expect(next).toBe('main');
    expect(readBranchBase(projectPath)).toBe('main');
  });

  it('0→1 auto-apply is a no-op when locked', async () => {
    await gitAnchor.ensureAnchor({ projectId: 'p', anchorPath, branchBase: 'main', userContext: uc });
    execFileSync('git', ['--git-dir', anchorPath, 'remote', 'add', 'origin', 'https://example.invalid/repo.git']);
    mkFeature('login');
    await applyAfterFeatureCreate(ctx, 'login');
    expect(readBranchBase(projectPath)).toBe('main');
  });

  it('listFeatureDirsByCreation orders oldest first', async () => {
    mkFeature('b');
    await new Promise((r) => setTimeout(r, 20));
    mkFeature('a');
    const names = (await listFeatureDirsByCreation(projectPath)).map((f) => f.name);
    expect(names).toEqual(['b', 'a']);
  });

  describe('applyAfterRemoteConverge', () => {
    /** Local "remote" whose HEAD names the given default branch. */
    function mkRemote(defaultBranch: string): string {
      const remoteDir = path.join(projectPath, 'remote-src');
      fs.mkdirSync(remoteDir, { recursive: true });
      execFileSync('git', ['-C', remoteDir, 'init', '-b', defaultBranch]);
      execFileSync('git', ['-C', remoteDir, 'config', 'user.email', 't@t']);
      execFileSync('git', ['-C', remoteDir, 'config', 'user.name', 't']);
      fs.writeFileSync(path.join(remoteDir, 'a.txt'), 'a');
      execFileSync('git', ['-C', remoteDir, 'add', '.']);
      execFileSync('git', ['-C', remoteDir, 'commit', '-m', 'c1']);
      return remoteDir;
    }

    it('records the remote HEAD as branchBase (+ anchor HEAD) and returns it', async () => {
      await gitAnchor.ensureAnchor({ projectId: 'p', anchorPath, branchBase: 'main', userContext: uc });
      const remoteDir = mkRemote('master');
      execFileSync('git', ['--git-dir', anchorPath, 'remote', 'add', 'origin', remoteDir]);

      const converged = await applyAfterRemoteConverge(ctx);

      expect(converged).toBe('master');
      expect(readBranchBase(projectPath)).toBe('master');
      expect(await gitAnchor.readHeadBranch(anchorPath)).toBe('master');
      expect(await isBranchBaseLocked(anchorPath)).toBe(true);
    });

    it('is a no-op when the remote HEAD matches the current pointer', async () => {
      await gitAnchor.ensureAnchor({ projectId: 'p', anchorPath, branchBase: 'main', userContext: uc });
      const remoteDir = mkRemote('main');
      execFileSync('git', ['--git-dir', anchorPath, 'remote', 'add', 'origin', remoteDir]);

      expect(await applyAfterRemoteConverge(ctx)).toBe('main');
      expect(readBranchBase(projectPath)).toBe('main');
    });

    it('unreachable remote: detection falls back to the anchor HEAD → pointer unchanged', async () => {
      await gitAnchor.ensureAnchor({ projectId: 'p', anchorPath, branchBase: 'main', userContext: uc });
      execFileSync('git', ['--git-dir', anchorPath, 'remote', 'add', 'origin', 'https://example.invalid/repo.git']);

      expect(await applyAfterRemoteConverge(ctx)).toBe('main');
      expect(readBranchBase(projectPath)).toBe('main');
    });
  });
});

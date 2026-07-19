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
  applyBeforeBaseFeatureDelete,
  setBranchBaseManual,
  isBranchBaseLocked,
  readBranchBase,
  listFeatureDirsByCreation,
  type BranchBaseContext,
} from '../../src/periphery/adapters/http/services/GitService/anchor/branchBaseLifecycle';
import { gitAnchor } from '../../src/periphery/adapters/http/services/GitService/anchor/GitAnchorSSOT';

const uc = { userId: 'u', organizationId: 'o' };

let projectPath: string;
let anchorPath: string;
let ctx: BranchBaseContext;

function mkFeature(name: string): void {
  fs.mkdirSync(path.join(projectPath, 'features', name, 'codebase'), { recursive: true });
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
    await expect(setBranchBaseManual(ctx, 'feat/x')).rejects.toThrow(/invalid/i);
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
});

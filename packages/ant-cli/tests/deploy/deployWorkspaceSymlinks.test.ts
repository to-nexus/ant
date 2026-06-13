import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
  syncDeployWorkspace,
  resolveDeployWorkspacePath,
} from '../../src/infrastructure/deploy/DeployWorkspace';

/**
 * Regression anchor for the monorepo deploy install failure
 * (`Dependency install failed: npm install failed with exit code 1`).
 *
 * Root cause: the deploy workspace excluded every `node_modules` from the
 * sync and created only ONE root symlink. For a pnpm-workspace monorepo,
 * per-package `node_modules` were therefore missing in the deploy tree, so
 * `next build` in `deploy/apps/web` could neither resolve `next` nor skip
 * install — it fell back to `npm install`, which chokes on `workspace:*`.
 *
 * Fix: mirror the codebase's `node_modules` symlink layout at EVERY package
 * level. These tests drive the public `syncDeployWorkspace`.
 */

async function makeFile(p: string, content = ''): Promise<void> {
  await fsp.mkdir(path.dirname(p), { recursive: true });
  await fsp.writeFile(p, content);
}

describe('syncDeployWorkspace — node_modules mirroring', () => {
  let tmp: string;
  let codebase: string;

  beforeEach(async () => {
    tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'ant-deploy-ws-'));
    codebase = path.join(tmp, 'codebase');
    await fsp.mkdir(codebase, { recursive: true });
  });

  afterEach(async () => {
    await fsp.rm(tmp, { recursive: true, force: true });
  });

  it('mirrors per-package node_modules for a workspace monorepo', async () => {
    // Root manifest + workspace marker.
    await makeFile(path.join(codebase, 'package.json'), JSON.stringify({ name: 'ws' }));
    await makeFile(path.join(codebase, 'pnpm-workspace.yaml'), "packages:\n  - 'apps/*'\n  - 'packages/*'\n");
    await makeFile(path.join(codebase, 'node_modules', '.sentinel'), 'root');

    // Two workspace members, each with their own node_modules (pnpm layout).
    await makeFile(path.join(codebase, 'apps/web/package.json'), JSON.stringify({ name: 'web' }));
    await makeFile(path.join(codebase, 'apps/web/node_modules', '.bin', 'next'), '#!/bin/sh\n');
    await makeFile(path.join(codebase, 'packages/lib/package.json'), JSON.stringify({ name: 'lib' }));
    await makeFile(path.join(codebase, 'packages/lib/node_modules', '.sentinel'), 'lib');

    const deploy = await syncDeployWorkspace(codebase);
    expect(deploy).toBe(resolveDeployWorkspacePath(codebase));

    for (const rel of ['node_modules', 'apps/web/node_modules', 'packages/lib/node_modules']) {
      const link = path.join(deploy, rel);
      const stat = await fsp.lstat(link);
      expect(stat.isSymbolicLink(), `${rel} should be a symlink`).toBe(true);
    }

    // Sentinels resolve through the per-package links into the codebase.
    expect(fs.readFileSync(path.join(deploy, 'apps/web/node_modules', '.bin', 'next'), 'utf-8')).toContain('#!/bin/sh');
    expect(fs.readFileSync(path.join(deploy, 'packages/lib/node_modules', '.sentinel'), 'utf-8')).toBe('lib');

    // Source files are synced; node_modules themselves are never copied (link only).
    expect(fs.existsSync(path.join(deploy, 'apps/web/package.json'))).toBe(true);
  });

  it('single-package repo links only the root (no spurious sub-links)', async () => {
    await makeFile(path.join(codebase, 'package.json'), JSON.stringify({ name: 'solo' }));
    await makeFile(path.join(codebase, 'node_modules', '.sentinel'), 'root');
    await makeFile(path.join(codebase, 'src/index.ts'), 'export {};');

    const deploy = await syncDeployWorkspace(codebase);

    const rootStat = await fsp.lstat(path.join(deploy, 'node_modules'));
    expect(rootStat.isSymbolicLink()).toBe(true);
    expect(fs.existsSync(path.join(deploy, 'src/index.ts'))).toBe(true);
  });

  it('is idempotent — re-sync keeps the symlinks correct', async () => {
    await makeFile(path.join(codebase, 'package.json'), JSON.stringify({ name: 'ws' }));
    await makeFile(path.join(codebase, 'apps/web/package.json'), JSON.stringify({ name: 'web' }));
    await makeFile(path.join(codebase, 'apps/web/node_modules', '.sentinel'), 'web');

    const deploy = await syncDeployWorkspace(codebase);
    await syncDeployWorkspace(codebase);

    const stat = await fsp.lstat(path.join(deploy, 'apps/web/node_modules'));
    expect(stat.isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(path.join(deploy, 'apps/web/node_modules', '.sentinel'), 'utf-8')).toBe('web');
  });
});

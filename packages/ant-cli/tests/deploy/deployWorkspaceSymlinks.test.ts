import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
  syncDeployWorkspace,
  resolveDeployWorkspacePath,
  installDeployDependencies,
} from '../../src/infrastructure/deploy/DeployWorkspace';

/**
 * Regression anchor for the Next 16 / Turbopack deploy build failure
 * (`Symlink [project]/apps/X/node_modules is invalid, it points out of the
 * filesystem root`).
 *
 * Root cause: the deploy workspace shared deps by symlinking each package's
 * `node_modules` to the sibling `codebase/node_modules`. That target escapes
 * the deploy workspace root, and Turbopack rejects root-escaping symlinks.
 *
 * Fix: NO node_modules symlinks. The deploy workspace gets its own real,
 * self-contained `node_modules` via `installDeployDependencies` (bundler-
 * agnostic). These tests lock that the sync never (re)introduces an escaping
 * symlink and that install short-circuits when deps already exist.
 */

async function makeFile(p: string, content = ''): Promise<void> {
  await fsp.mkdir(path.dirname(p), { recursive: true });
  await fsp.writeFile(p, content);
}

describe('syncDeployWorkspace — no escaping node_modules symlink', () => {
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

  it('syncs source but creates NO node_modules symlink (monorepo)', async () => {
    await makeFile(path.join(codebase, 'package.json'), JSON.stringify({ name: 'ws' }));
    await makeFile(path.join(codebase, 'pnpm-workspace.yaml'), "packages:\n  - 'apps/*'\n");
    await makeFile(path.join(codebase, 'node_modules', '.sentinel'), 'root');
    await makeFile(path.join(codebase, 'apps/web/package.json'), JSON.stringify({ name: 'web' }));
    await makeFile(path.join(codebase, 'apps/web/node_modules', '.bin', 'next'), '#!/bin/sh\n');

    const deploy = await syncDeployWorkspace(codebase);
    expect(deploy).toBe(resolveDeployWorkspacePath(codebase));

    // Source files are synced...
    expect(fs.existsSync(path.join(deploy, 'apps/web/package.json'))).toBe(true);

    // ...but no node_modules is copied OR symlinked at any level.
    for (const rel of ['node_modules', 'apps/web/node_modules']) {
      const lstat = await fsp.lstat(path.join(deploy, rel)).catch(() => null);
      expect(lstat, `${rel} must not exist after sync`).toBeNull();
    }
  });

  it('re-sync never introduces a node_modules symlink', async () => {
    await makeFile(path.join(codebase, 'package.json'), JSON.stringify({ name: 'solo' }));
    await makeFile(path.join(codebase, 'node_modules', '.sentinel'), 'root');
    await makeFile(path.join(codebase, 'src/index.ts'), 'export {};');

    const deploy = await syncDeployWorkspace(codebase);
    await syncDeployWorkspace(codebase);

    expect(await fsp.lstat(path.join(deploy, 'node_modules')).catch(() => null)).toBeNull();
    expect(fs.existsSync(path.join(deploy, 'src/index.ts'))).toBe(true);
  });

  it('installDeployDependencies short-circuits when node_modules/.bin exists', async () => {
    const deploy = path.join(tmp, 'deploy');
    await makeFile(path.join(deploy, 'package.json'), JSON.stringify({ name: 'ws' }));
    await makeFile(path.join(deploy, 'node_modules', '.bin', 'next'), '#!/bin/sh\n');

    const logs: string[] = [];
    await installDeployDependencies(deploy, (l) => logs.push(l));

    // No real install ran (would need network); it skipped.
    expect(logs.join('\n')).toMatch(/already present/i);
  });
});

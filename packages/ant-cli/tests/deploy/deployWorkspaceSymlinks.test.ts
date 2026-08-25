import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
  syncDeployWorkspace,
  resolveDeployWorkspacePath,
  installDeployDependencies,
  purgeNodeModulesSymlinks,
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

  it('manifest-less static site: the detected doc root escapes the exclude list (dist/index.html deploys)', async () => {
    await makeFile(path.join(codebase, 'dist/index.html'), '<h1>site</h1>');
    await makeFile(path.join(codebase, 'dist/assets/app.js'), 'x');

    const deploy = await syncDeployWorkspace(codebase);
    expect(fs.existsSync(path.join(deploy, 'dist/index.html'))).toBe(true);
    expect(fs.existsSync(path.join(deploy, 'dist/assets/app.js'))).toBe(true);
  });

  it('a Node project keeps dist excluded (build artifacts are produced by the deploy build itself)', async () => {
    await makeFile(path.join(codebase, 'package.json'), JSON.stringify({ name: 'app', scripts: { dev: 'vite' } }));
    await makeFile(path.join(codebase, 'dist/artifact.js'), 'x');
    await makeFile(path.join(codebase, 'src/index.ts'), 'export {};');

    const deploy = await syncDeployWorkspace(codebase);
    expect(fs.existsSync(path.join(deploy, 'src/index.ts'))).toBe(true);
    expect(fs.existsSync(path.join(deploy, 'dist'))).toBe(false);
  });

  it('root-doc-root static site: only the DETECTED doc root is lifted — junk build/ stays excluded', async () => {
    await makeFile(path.join(codebase, 'report.html'), '<h1>report</h1>');
    await makeFile(path.join(codebase, 'build/junk.bin'), 'x');

    const deploy = await syncDeployWorkspace(codebase);
    expect(fs.existsSync(path.join(deploy, 'report.html'))).toBe(true);
    expect(fs.existsSync(path.join(deploy, 'build'))).toBe(false);
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

  it('installDeployDependencies short-circuits when REAL node_modules/.bin exists', async () => {
    const deploy = path.join(tmp, 'deploy');
    await makeFile(path.join(deploy, 'package.json'), JSON.stringify({ name: 'ws' }));
    await makeFile(path.join(deploy, 'node_modules', '.bin', 'next'), '#!/bin/sh\n');

    const logs: string[] = [];
    await installDeployDependencies(deploy, (l) => logs.push(l));

    // No real install ran (would need network); it skipped.
    expect(logs.join('\n')).toMatch(/already present/i);
  });

  it('purgeNodeModulesSymlinks removes stale escaping symlinks (root + per-package), keeps real dirs', async () => {
    // Reproduce the 2nd-round recurrence: a persisted deploy tree still holds
    // the pre-fix escaping symlinks `deploy/.../node_modules → codebase/...`.
    // The link target is a populated codebase node_modules — exactly why the
    // old existsSync(.bin) skip wrongly fired (it followed the link).
    await makeFile(path.join(codebase, 'node_modules', '.bin', 'next'), '#!/bin/sh\n');
    await makeFile(path.join(codebase, 'apps/web/node_modules', '.bin', 'next'), '#!/bin/sh\n');

    const deploy = path.join(tmp, 'deploy');
    await makeFile(path.join(deploy, 'package.json'), JSON.stringify({ name: 'ws' }));
    await makeFile(path.join(deploy, 'apps/web/package.json'), JSON.stringify({ name: 'web' }));
    // A package with a REAL node_modules must NOT be touched by the purge.
    await makeFile(path.join(deploy, 'packages/lib/package.json'), JSON.stringify({ name: 'lib' }));
    await makeFile(path.join(deploy, 'packages/lib/node_modules', '.sentinel'), 'real');
    // Stale escaping links at root + one package (what the old farm created).
    await fsp.symlink(path.join(codebase, 'node_modules'), path.join(deploy, 'node_modules'), 'dir');
    await fsp.symlink(path.join(codebase, 'apps/web/node_modules'), path.join(deploy, 'apps/web/node_modules'), 'dir');

    const purged = await purgeNodeModulesSymlinks(deploy);

    expect(purged).toBe(2);
    // Both escaping symlinks gone (the core fix).
    expect(await fsp.lstat(path.join(deploy, 'node_modules')).catch(() => null)).toBeNull();
    expect(await fsp.lstat(path.join(deploy, 'apps/web/node_modules')).catch(() => null)).toBeNull();
    // Real node_modules untouched.
    const realStat = await fsp.lstat(path.join(deploy, 'packages/lib/node_modules'));
    expect(realStat.isDirectory()).toBe(true);
    expect(fs.readFileSync(path.join(deploy, 'packages/lib/node_modules', '.sentinel'), 'utf-8')).toBe('real');
  });
});

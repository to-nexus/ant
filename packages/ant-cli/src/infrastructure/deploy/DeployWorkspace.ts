/**
 * DeployWorkspace
 *
 * Provides filesystem isolation between preview dev (`next dev`) and deploy
 * build/serve (`next build`/`next start`). Both would otherwise collide inside
 * the same `codebase/` directory — sharing `.next/` in particular, which
 * causes the running dev server to lose chunk references when `next build`
 * overwrites them (e.g. `Cannot find module './218.js'`).
 *
 * Strategy:
 *   1. Create a sibling `deploy/` next to `codebase/`.
 *   2. Incrementally sync source files from codebase → deploy (rsync preferred,
 *      Node fallback). First run copies everything; subsequent runs only
 *      transfer changed files.
 *   3. Exclude `.next`, `node_modules`, and other dev/build artifacts so
 *      deploy's own `.next/` (including `.next/cache` for fast rebuilds) is
 *      never clobbered.
 *   4. `node_modules` is NOT shared via symlink. A symlink pointing at the
 *      sibling `codebase/node_modules` escapes the deploy workspace root, and
 *      Next 16's Turbopack rejects such symlinks ("points out of the
 *      filesystem root"). Instead deploy gets its OWN real, self-contained
 *      `node_modules` via a frozen install at the deploy root (see
 *      DeployService.startDeploy). Because `node_modules` is in EXCLUDES, the
 *      rsync `--delete` never removes it, so it persists across snapshots
 *      (like `.next/cache`) — the install runs once then no-ops. A real tree
 *      is bundler-agnostic: it works under any bundler / Next version, unlike
 *      the previous escaping-symlink scheme that depended on the bundler
 *      following links out of root.
 */

import * as path from 'path';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import { spawn } from 'child_process';
import { detectPackageManager, buildInstallCommand } from '../../utils/packageManager';

/**
 * Directories/patterns we never copy into the deploy workspace.
 * Build artifacts (including deploy/.next) are produced by the build step
 * itself; copying dev's artifacts would defeat the isolation.
 */
const EXCLUDES = [
  '.next',
  'node_modules',
  '.deploy',
  '.git',
  '.turbo',
  '.cache',
  'dist',
  'build',
  'out',
  'coverage',
  '.DS_Store',
];

const LOG_PATTERN = /\.log$/;

/**
 * Resolve the deploy workspace path as a sibling of the codebase directory.
 * e.g. `.../features/{feature}/codebase` → `.../features/{feature}/deploy`.
 */
export function resolveDeployWorkspacePath(codebasePath: string): string {
  return path.join(path.dirname(codebasePath), 'deploy');
}

/**
 * Incrementally sync codebase → deploy workspace. Safe to call repeatedly.
 *
 * Uses rsync -a --delete when available (near-instant for unchanged trees,
 * transfers only diffs), falls back to a Node-based mtime/size walker.
 *
 * Dependency install is the caller's responsibility (DeployService runs a
 * frozen install at the deploy root once) — `node_modules` is excluded from
 * the sync and persists across snapshots, so it is never a symlink and never
 * escapes the deploy root.
 *
 * Returns the absolute deploy workspace path.
 */
export async function syncDeployWorkspace(
  codebasePath: string,
  onLog?: (line: string) => void
): Promise<string> {
  const deployPath = resolveDeployWorkspacePath(codebasePath);
  await fsp.mkdir(deployPath, { recursive: true });

  onLog?.(`🔄 Syncing codebase → deploy workspace (${deployPath})`);

  if (await hasRsync()) {
    await rsyncSync(codebasePath, deployPath, onLog);
  } else {
    await nodeIncrementalSync(codebasePath, deployPath, onLog);
  }

  onLog?.(`✅ Deploy workspace ready`);
  return deployPath;
}

/**
 * Check if rsync is available on the current host.
 */
function hasRsync(): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = spawn('rsync', ['--version'], { stdio: 'ignore', shell: false });
    probe.once('error', () => resolve(false));
    probe.once('exit', (code) => resolve(code === 0));
  });
}

/**
 * Run `rsync -a --delete` with exclusions. Trailing slash on source means
 * "copy contents", so source/foo lands at dest/foo (not dest/source/foo).
 *
 * --delete removes files in dest that no longer exist in source, but
 * excluded paths are preserved (that is how deploy/.next/cache survives
 * across snapshots even though codebase has no .next/).
 */
function rsyncSync(
  src: string,
  dest: string,
  onLog?: (line: string) => void
): Promise<void> {
  const args = ['-a', '--delete'];
  for (const ex of EXCLUDES) args.push(`--exclude=${ex}`);
  args.push('--exclude=*.log');
  args.push(src.endsWith(path.sep) ? src : `${src}${path.sep}`);
  args.push(dest.endsWith(path.sep) ? dest : `${dest}${path.sep}`);

  return new Promise((resolve, reject) => {
    const child = spawn('rsync', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr?.on('data', (d) => {
      stderr += d.toString();
    });
    child.on('error', (err) => reject(err));
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        onLog?.(`❌ rsync exited with code ${code}: ${stderr.trim()}`);
        reject(new Error(`rsync failed (code ${code}): ${stderr.trim()}`));
      }
    });
  });
}

/**
 * Node fallback for environments without rsync. Walks codebase, copies
 * files whose size or mtime differs from dest, removes dest-only entries.
 *
 * Only operates outside excluded directories, and preserves whatever lives
 * in deploy/ under those excluded names (e.g. deploy/.next/cache).
 */
async function nodeIncrementalSync(
  src: string,
  dest: string,
  onLog?: (line: string) => void
): Promise<void> {
  let copied = 0;
  let deleted = 0;

  await walkAndSync(src, dest, (evt) => {
    if (evt === 'copy') copied++;
    else if (evt === 'delete') deleted++;
  });

  onLog?.(`📦 Node sync: ${copied} copied, ${deleted} removed`);
}

async function walkAndSync(
  srcDir: string,
  destDir: string,
  tally: (evt: 'copy' | 'delete') => void
): Promise<void> {
  await fsp.mkdir(destDir, { recursive: true });

  const [srcEntries, destEntries] = await Promise.all([
    readDirSafe(srcDir),
    readDirSafe(destDir),
  ]);

  const srcNames = new Set<string>();
  for (const entry of srcEntries) {
    if (shouldExclude(entry.name)) continue;
    srcNames.add(entry.name);

    const srcChild = path.join(srcDir, entry.name);
    const destChild = path.join(destDir, entry.name);

    if (entry.isDirectory()) {
      await walkAndSync(srcChild, destChild, tally);
    } else if (entry.isSymbolicLink()) {
      const link = await fsp.readlink(srcChild);
      const destStat = await fsp.lstat(destChild).catch(() => null);
      if (!destStat || !destStat.isSymbolicLink() || (await fsp.readlink(destChild)) !== link) {
        if (destStat) await fsp.rm(destChild, { force: true, recursive: true });
        await fsp.symlink(link, destChild);
        tally('copy');
      }
    } else if (entry.isFile()) {
      await copyIfDiffers(srcChild, destChild, tally);
    }
  }

  // Delete dest-only entries (but never touch excluded names — that is how
  // deploy/.next/cache survives across snapshots).
  for (const entry of destEntries) {
    if (shouldExclude(entry.name)) continue;
    if (srcNames.has(entry.name)) continue;
    const destChild = path.join(destDir, entry.name);
    await fsp.rm(destChild, { recursive: true, force: true });
    tally('delete');
  }
}

async function readDirSafe(dir: string): Promise<fs.Dirent[]> {
  try {
    return await fsp.readdir(dir, { withFileTypes: true });
  } catch (err: any) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

function shouldExclude(name: string): boolean {
  if (EXCLUDES.includes(name)) return true;
  if (LOG_PATTERN.test(name)) return true;
  return false;
}

async function copyIfDiffers(
  src: string,
  dest: string,
  tally: (evt: 'copy') => void
): Promise<void> {
  const [srcStat, destStat] = await Promise.all([
    fsp.stat(src),
    fsp.stat(dest).catch(() => null),
  ]);

  if (
    destStat &&
    destStat.size === srcStat.size &&
    Math.abs(destStat.mtimeMs - srcStat.mtimeMs) < 1000
  ) {
    return;
  }

  await fsp.mkdir(path.dirname(dest), { recursive: true });
  await fsp.copyFile(src, dest);
  // Preserve mtime so subsequent syncs can short-circuit.
  await fsp.utimes(dest, srcStat.atime, srcStat.mtime);
  tally('copy');
}

const INSTALL_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Ensure the deploy workspace has its own real `node_modules`.
 *
 * Runs ONE install at the deploy workspace root (not per-package): pnpm/yarn
 * link the whole workspace from a sub-dir, but npm workspaces require the root,
 * so we always install at the root for correctness across package managers.
 * Includes devDependencies (build tools live there) via `buildInstallCommand`.
 *
 * Idempotent across deploys: `node_modules` is excluded from the rsync and
 * persists, so a warm install is a near-no-op (store hardlinks, lockfile
 * already satisfied). Skips entirely when a populated `node_modules/.bin`
 * already exists at the root.
 */
export async function installDeployDependencies(
  deployRoot: string,
  onLog?: (line: string) => void
): Promise<void> {
  const binDir = path.join(deployRoot, 'node_modules', '.bin');
  if (fs.existsSync(binDir)) {
    onLog?.(`📦 Deploy node_modules already present — skipping install`);
    return;
  }

  const pm = detectPackageManager(deployRoot);
  const { command, args } = buildInstallCommand(pm);
  onLog?.(`📦 Installing deploy dependencies (${pm}) at workspace root...`);

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const child = spawn(command, args, {
      cwd: deployRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
    });

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      onLog?.(`❌ ${pm} install timed out (5 minutes)`);
      try { child.kill('SIGTERM'); } catch { /* ignore */ }
      setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* ignore */ } }, 5000);
      reject(new Error(`${pm} install timed out`));
    }, INSTALL_TIMEOUT_MS);

    const pipe = (data: Buffer) =>
      data.toString().split('\n').filter(Boolean).forEach((line) => onLog?.(line));
    child.stdout?.on('data', pipe);
    child.stderr?.on('data', pipe);

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) {
        onLog?.(`✅ Deploy dependencies installed`);
        resolve();
      } else {
        const err = `${pm} install failed with exit code ${code}`;
        onLog?.(`❌ ${err}`);
        reject(new Error(err));
      }
    });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      onLog?.(`❌ Install error: ${err.message}`);
      reject(err);
    });
  });
}

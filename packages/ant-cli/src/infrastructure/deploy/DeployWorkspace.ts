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
 *   4. Share `node_modules` via symlink, mirrored at EVERY workspace package
 *      level — not just the root. pnpm does not hoist most deps to the root,
 *      so a single `deploy/node_modules` link is insufficient for a monorepo:
 *      `next build` in `deploy/apps/web` needs `deploy/apps/web/node_modules`
 *      to resolve `next` + `workspace:*` deps. Each per-package link points at
 *      the codebase's real (already-installed) symlink farm; deploy reads
 *      only, install happens in codebase via PreviewService's Redis-locked path.
 */

import * as path from 'path';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import { spawn } from 'child_process';
import { enumeratePackageJsonManifests } from '../../utils/workspacePackages';

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
 * After sync, ensures `deploy/node_modules` is a symlink into
 * `codebase/node_modules` so the build can resolve deps without reinstalling.
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

  await ensureNodeModulesSymlinks(codebasePath, deployPath);

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

/**
 * Mirror the codebase's `node_modules` symlink layout into the deploy tree at
 * every workspace package level. For each package dir (root + every workspace
 * member, discovered via the shared manifest walk) that actually has a
 * `node_modules` in the codebase, create a matching symlink in deploy.
 *
 * Single-package repos resolve to just the root link — identical to before.
 */
async function ensureNodeModulesSymlinks(
  codebasePath: string,
  deployPath: string
): Promise<void> {
  const manifests = await enumeratePackageJsonManifests(codebasePath);
  const pkgDirs = new Set(manifests.map((m) => path.dirname(m)));

  for (const dir of pkgDirs) {
    const target = path.join(dir, 'node_modules');
    // Mirror only what the codebase actually installed.
    const targetStat = await fsp.lstat(target).catch(() => null);
    if (!targetStat) continue;

    const rel = path.relative(codebasePath, dir); // '' for the workspace root
    const link = path.join(deployPath, rel, 'node_modules');
    await linkNodeModules(target, link);
  }
}

/**
 * Link a single `node_modules` into the deploy tree. If it is already the
 * correct symlink we leave it alone; if it exists as a regular directory
 * (from a prior attempt) we remove it before relinking. Prefers relative
 * symlinks so the deploy workspace stays portable if the base path moves
 * (e.g. from local laptop layout to EFS).
 */
async function linkNodeModules(target: string, link: string): Promise<void> {
  const existing = await fsp.lstat(link).catch(() => null);
  if (existing) {
    if (existing.isSymbolicLink()) {
      const current = await fsp.readlink(link).catch(() => '');
      if (path.resolve(path.dirname(link), current) === path.resolve(target)) {
        return;
      }
    }
    await fsp.rm(link, { recursive: true, force: true });
  }

  await fsp.mkdir(path.dirname(link), { recursive: true });
  const rel = path.relative(path.dirname(link), target);
  await fsp.symlink(rel || target, link, 'dir');
}

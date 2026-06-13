/**
 * workspacePackages — codebase-disk SSOT for enumerating workspace manifests.
 *
 * A single depth-bounded directory walk that lists every `package.json` in a
 * tree, pruning the build/cache/VCS dirs the user-edited source never carries.
 * Shared so all consumers agree on "what packages exist on disk":
 *   - `workspaceDepPins.ts` (pin-conflict snapshot)
 *   - `invalidationScope.ts::areDepsInstalled` (install-status)
 *   - `infrastructure/deploy/DeployWorkspace.ts` (per-package node_modules mirror)
 *
 * Globs in `pnpm-workspace.yaml` / `package.json#workspaces` are intentionally
 * NOT consulted — relative paths, negation, and `**` make them brittle, and a
 * pruned walk is both simpler and equally bounded.
 */

import * as path from 'path';
import * as fs from 'fs';

export const SKIP_DIR_NAMES = new Set([
  'node_modules', '.git', '.next', '.nuxt', '.turbo', '.cache',
  'dist', 'build', 'out', 'coverage', '.vercel', '.svelte-kit',
]);

/**
 * Walk the codebase and collect every `package.json` excluding ones under
 * `node_modules/` and other build/cache directories.
 */
export async function enumeratePackageJsonManifests(codebasePath: string): Promise<string[]> {
  const found: string[] = [];

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > 6) return;
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (SKIP_DIR_NAMES.has(entry.name)) continue;
        if (entry.name.startsWith('.') && entry.name !== '.') continue;
        await walk(path.join(dir, entry.name), depth + 1);
      } else if (entry.isFile() && entry.name === 'package.json') {
        found.push(path.join(dir, entry.name));
      }
    }
  }

  try {
    await fs.promises.stat(codebasePath);
  } catch {
    return [];
  }
  await walk(codebasePath, 0);
  return found;
}

/**
 * compressPathsByFolder — BE adapter over the shared
 * `compressPathsByFolderCore` (`@ant/shared/folders-compressed`).
 *
 * The collapse *decision* (recursive full-subtree coverage, dotfile immunity,
 * topmost-dir selection) is the shared SSOT. This wrapper only supplies the
 * I/O: it async-reads the candidate directories' subtrees through the
 * `FileSystemPort` into a memoized map, then hands the core a sync,
 * map-backed `listDir`. (The FE supplies its own sync `fileTree`-backed
 * `listDir` to the same core.)
 *
 * Used by the explicit (chat user-message) and infer (Detect node) paths so
 * the chat <detect> summary and the FE `ActionMetadataBadges` render
 * `📂 dir/ (N files)` instead of a long list. Display-only — `foldersCompressed`
 * is never read by RAC/pool code.
 */

import path from 'node:path';
import {
  compressPathsByFolderCore,
  type DirEntry,
  type PathOrFolder,
} from '@ant/shared';
import type { FileSystemPort } from '../ports/filesystem.js';

function isRootish(dir: string): boolean {
  return dir === '.' || dir === '' || dir === '/';
}

export async function compressPathsByFolder(
  paths: readonly string[],
  fileSystem: FileSystemPort,
): Promise<PathOrFolder[]> {
  if (paths.length === 0) return [];

  // Read each directory at most once; `null` marks an unlistable directory.
  const dirCache = new Map<string, DirEntry[] | null>();

  // Recursively read `dir` and its non-hidden subtree into the cache so the
  // sync core can resolve every directory it queries from memory.
  const gather = async (dir: string): Promise<void> => {
    if (dirCache.has(dir)) return;
    let entries: DirEntry[] | null;
    try {
      entries = await fileSystem.readDirectory(dir);
    } catch {
      dirCache.set(dir, null);
      return;
    }
    dirCache.set(dir, entries);
    for (const e of entries) {
      if (e.isDirectory && !e.name.startsWith('.')) {
        await gather(`${dir}/${e.name}`);
      }
    }
  };

  // Gather the subtree rooted at every ancestor directory of a selected path
  // (memoized, so overlapping ancestor chains read each directory once).
  const ancestors = new Set<string>();
  for (const p of paths) {
    let dir = path.posix.dirname(p);
    while (!isRootish(dir)) {
      ancestors.add(dir);
      dir = path.posix.dirname(dir);
    }
  }
  for (const dir of ancestors) await gather(dir);

  return compressPathsByFolderCore(paths, (dir) => dirCache.get(dir) ?? null);
}

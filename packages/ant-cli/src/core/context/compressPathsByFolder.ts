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
  ACTION_METADATA_MAX_PATHS,
  compressPathsByFolderCore,
  type DirEntry,
  type PathOrFolder,
} from '@ant/shared';
import type { FileSystemPort } from '../ports/filesystem.js';

/**
 * Walk budget — the sink half of `ACTION_METADATA_MAX_PATHS`.
 *
 * `paths` comes straight off the wire (`actionMetadata.target/refs/context`), and
 * every entry opens an independent `gather()` root that recursed with no depth,
 * breadth or entry bound — on the request's critical path, before the durable
 * append (M-NEW-029). Memoization only dedupes IDENTICAL directory strings, so N
 * distinct prefixes meant N independent unbounded walks.
 *
 * One budget spans ALL roots (the same discipline as the universal artifact
 * tree: charge as you read, not per walk). Exhausting it is NOT an error —
 * ungathered directories are already modelled as `null` ("unlistable"), so the
 * result degrades to *less folder compression* and never to a failed request.
 * This is display-only metadata; refusing it would break a working feature to
 * bound a cost that stopping the walk already bounds.
 *
 * Sized to match the universal tree budget, well above any real selection.
 */
const FOLDER_SCAN_MAX_ENTRIES = 5000;
const FOLDER_SCAN_MAX_DEPTH = 12;

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
  // One budget across every root — see FOLDER_SCAN_MAX_ENTRIES.
  let remaining = FOLDER_SCAN_MAX_ENTRIES;

  // Recursively read `dir` and its non-hidden subtree into the cache so the
  // sync core can resolve every directory it queries from memory.
  const gather = async (dir: string, depth: number): Promise<void> => {
    if (dirCache.has(dir)) return;
    if (remaining <= 0 || depth > FOLDER_SCAN_MAX_DEPTH) return;
    let entries: DirEntry[] | null;
    try {
      entries = await fileSystem.readDirectory(dir);
    } catch {
      dirCache.set(dir, null);
      return;
    }
    // Charge every raw entry, hidden ones included — the cost is in reading
    // them, not in whether the walk descends.
    remaining -= entries.length;
    dirCache.set(dir, entries);
    if (remaining <= 0) return;
    for (const e of entries) {
      if (e.isDirectory && !e.name.startsWith('.')) {
        await gather(`${dir}/${e.name}`, depth + 1);
      }
    }
  };

  // Defence in depth: the HTTP schema bounds the slot count, but the worker
  // (Detect) reaches this helper without passing through it.
  const roots = paths.length > ACTION_METADATA_MAX_PATHS
    ? paths.slice(0, ACTION_METADATA_MAX_PATHS)
    : paths;

  // Gather the subtree rooted at every ancestor directory of a selected path
  // (memoized, so overlapping ancestor chains read each directory once).
  const ancestors = new Set<string>();
  for (const p of roots) {
    let dir = path.posix.dirname(p);
    while (!isRootish(dir)) {
      ancestors.add(dir);
      dir = path.posix.dirname(dir);
    }
  }
  for (const dir of ancestors) await gather(dir, 0);
  // Also probe the selected paths themselves: a directory-granular selection
  // (handoff bundle root, dir-level target) must be resolvable by the core's
  // self-directory branch. A file path throws ENOTDIR and caches `null`.
  for (const p of roots) await gather(p, 0);

  return compressPathsByFolderCore(paths, (dir) => dirCache.get(dir) ?? null);
}

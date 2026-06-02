/**
 * compressPathsByFolderCore — collapse a list of file paths into a folder entry
 * when *every* (recursive, non-hidden) file under a directory is selected.
 *
 * This is the single SSOT for the directory-collapse decision shared by both
 * runtimes: the BE wraps it with an async filesystem `listDir`
 * (`core/context/compressPathsByFolder.ts`), the FE wraps it with a sync
 * in-memory `fileTree` `listDir` (chat `ActionMetadataBadges`). The decision
 * (candidate ancestors, coverage, dotfile immunity, topmost-dir selection,
 * ordered emit) lives only here; the two sides differ only in their `listDir`
 * I/O adapter.
 *
 * Compression rule:
 *   - A directory `D` collapses when every non-hidden file in its *entire
 *     subtree* (recursively) is in the selection set. The **topmost** such
 *     directory wins, so a whole-folder selection that spans sub-dirs
 *     (e.g. handoff/index.html + handoff/screens/login.md) emits one
 *     `handoff/` entry rather than per-sub-dir entries.
 *   - Files not under any fully-covered directory stay as individual entries.
 *   - A directory whose subtree holds < 2 files never collapses (no value).
 *   - Dotfiles / dot-directories (names starting with `.`) are ignored when
 *     judging coverage and never counted.
 *   - A `listDir` returning `null` (unlistable directory) makes that directory
 *     non-collapsible — it degrades to its files / smaller fully-covered
 *     sub-dirs.
 */

import type { PathOrFolder } from './actions';

export interface DirEntry {
  name: string;
  isDirectory: boolean;
}

/** Lists the immediate children of `dir`, or `null` if unlistable. */
export type ListDir = (dir: string) => readonly DirEntry[] | null;

/** POSIX `dirname` without a Node dependency (browser-safe). */
function posixDirname(p: string): string {
  const i = p.lastIndexOf('/');
  if (i < 0) return '.';
  if (i === 0) return '/';
  return p.slice(0, i);
}

function isRootish(dir: string): boolean {
  return dir === '.' || dir === '' || dir === '/';
}

/** All ancestor directories of `filePath`, deepest-first, excluding root. */
function ancestorsOf(filePath: string): string[] {
  const out: string[] = [];
  let dir = posixDirname(filePath);
  while (!isRootish(dir)) {
    out.push(dir);
    dir = posixDirname(dir);
  }
  return out;
}

export function compressPathsByFolderCore(
  paths: readonly string[],
  listDir: ListDir,
): PathOrFolder[] {
  if (paths.length === 0) return [];

  // Dedupe while preserving first-occurrence order.
  const seen = new Set<string>();
  const uniqPaths: string[] = [];
  for (const p of paths) {
    if (!seen.has(p)) {
      seen.add(p);
      uniqPaths.push(p);
    }
  }
  const selectedSet = new Set(uniqPaths);

  // Recursive non-hidden file list under `dir`. `null` if any subtree
  // directory is unlistable (→ `dir` is treated as non-collapsible).
  const fileCache = new Map<string, string[] | null>();
  const collectFiles = (dir: string): string[] | null => {
    const cached = fileCache.get(dir);
    if (cached !== undefined) return cached;
    const entries = listDir(dir);
    if (entries === null) {
      fileCache.set(dir, null);
      return null;
    }
    const files: string[] = [];
    for (const e of entries) {
      if (e.name.startsWith('.')) continue; // dotfile / dot-dir immunity
      const child = `${dir}/${e.name}`;
      if (e.isDirectory) {
        const sub = collectFiles(child);
        if (sub === null) {
          fileCache.set(dir, null);
          return null;
        }
        files.push(...sub);
      } else {
        files.push(child);
      }
    }
    fileCache.set(dir, files);
    return files;
  };

  // Candidate directories: every ancestor of a selected path.
  const candidates = new Set<string>();
  for (const p of uniqPaths) {
    for (const dir of ancestorsOf(p)) candidates.add(dir);
  }

  // A directory collapses when its whole non-hidden subtree (≥ 2 files) is
  // selected. `fileCount` is the recursive file count.
  const collapsible = new Map<string, number>();
  for (const dir of candidates) {
    const files = collectFiles(dir);
    if (files === null || files.length < 2) continue;
    if (files.every((f) => selectedSet.has(f))) {
      collapsible.set(dir, files.length);
    }
  }

  // Keep only the topmost collapsible directory per covered subtree.
  const chosen: string[] = [...collapsible.keys()].sort(
    (a, b) => a.split('/').length - b.split('/').length,
  );
  const roots: string[] = [];
  for (const dir of chosen) {
    if (roots.some((r) => dir === r || dir.startsWith(r + '/'))) continue;
    roots.push(dir);
  }

  const folderFor = (p: string): string | undefined =>
    roots.find((r) => p.startsWith(r + '/'));

  // Emit in original order; a selected file under a chosen root emits that
  // root once (at first occurrence).
  const out: PathOrFolder[] = [];
  const emitted = new Set<string>();
  for (const p of uniqPaths) {
    const root = folderFor(p);
    if (root) {
      if (!emitted.has(root)) {
        out.push({ kind: 'folder', path: root, fileCount: collapsible.get(root)! });
        emitted.add(root);
      }
      continue;
    }
    out.push({ kind: 'file', path: p });
  }
  return out;
}

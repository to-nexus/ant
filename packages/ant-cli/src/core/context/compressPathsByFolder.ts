/**
 * compressPathsByFolder — collapse a list of file paths into a folder entry
 * when *every* (recursive, non-hidden) file under a directory is selected.
 * Used by the explicit (chat user-message) and infer (Detect node) paths so
 * the chat <detect> summary and the FE ActionMetadataBadges render
 * `📂 dir/ (N files)` instead of a long list when the slot covers a folder in
 * full. Display-only — `foldersCompressed` is never read by RAC/pool code.
 *
 * Compression rule:
 *   - A directory `D` collapses when every non-hidden file in its *entire
 *     subtree* (recursively) is in the selection set. The **topmost** such
 *     directory wins, so a whole-folder selection that spans sub-dirs
 *     (e.g. handoff/index.html + handoff/screens/login.md) emits one
 *     `handoff/` entry rather than per-sub-dir entries.
 *   - Files not under any fully-covered directory stay as individual entries.
 *   - A directory whose subtree holds < 2 files never collapses (no value).
 *   - Dotfiles / dot-directories (names starting with `.`, e.g. `.DS_Store`,
 *     `.git`) are ignored when judging coverage and never counted.
 *   - Any `readDirectory` failure inside a directory's subtree makes that
 *     directory non-collapsible — it degrades to its files / smaller fully-
 *     covered sub-dirs (no throw, no warn — the caller is rendering a UI hint).
 */

import path from 'node:path';
import type { PathOrFolder } from '@ant/shared';
import type { FileSystemPort } from '../ports/filesystem.js';

function isRootish(dir: string): boolean {
  return dir === '.' || dir === '' || dir === '/';
}

/** All ancestor directories of `filePath`, deepest-first, excluding root. */
function ancestorsOf(filePath: string): string[] {
  const out: string[] = [];
  let dir = path.posix.dirname(filePath);
  while (!isRootish(dir)) {
    out.push(dir);
    dir = path.posix.dirname(dir);
  }
  return out;
}

export async function compressPathsByFolder(
  paths: readonly string[],
  fileSystem: FileSystemPort,
): Promise<PathOrFolder[]> {
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

  // Memoized directory listing — `null` marks an unlistable directory.
  const dirCache = new Map<string, Array<{ name: string; isDirectory: boolean }> | null>();
  const readDir = async (dir: string) => {
    const cached = dirCache.get(dir);
    if (cached !== undefined) return cached;
    let entries: Array<{ name: string; isDirectory: boolean }> | null;
    try {
      entries = await fileSystem.readDirectory(dir);
    } catch {
      entries = null;
    }
    dirCache.set(dir, entries);
    return entries;
  };

  // Recursive non-hidden file list under `dir`. `null` if any subtree
  // directory is unlistable (→ caller treats `dir` as non-collapsible).
  const fileCache = new Map<string, string[] | null>();
  const collectFiles = async (dir: string): Promise<string[] | null> => {
    const cached = fileCache.get(dir);
    if (cached !== undefined) return cached;
    const entries = await readDir(dir);
    if (entries === null) {
      fileCache.set(dir, null);
      return null;
    }
    const files: string[] = [];
    for (const e of entries) {
      if (e.name.startsWith('.')) continue; // dotfile / dot-dir immunity
      const child = `${dir}/${e.name}`;
      if (e.isDirectory) {
        const sub = await collectFiles(child);
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
    const files = await collectFiles(dir);
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

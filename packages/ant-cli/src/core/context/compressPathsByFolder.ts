/**
 * compressPathsByFolder — collapse a list of file paths into a folder entry
 * when *every* file in that directory is selected. Used by the explicit
 * (chat user-message) and infer (Detect node) paths so the chat <detect>
 * summary and the FE ActionMetadataBadges render `📂 dir/ (N files)` instead
 * of a long list when the slot covers a folder in full.
 *
 * Compression rule (per parent directory):
 *   - selected.length < 2                 → keep as files (no value).
 *   - parent is root / current             → keep as files.
 *   - readDirectory(parent) lists N files,
 *     selected covers exactly that set     → emit one `folder` entry.
 *   - any other case                       → keep as files.
 *
 * Sub-directories inside `parent` are ignored — only direct files count.
 * `readDirectory` failures degrade to files (no throw, no warn — the caller
 * is rendering a UI hint, not enforcing).
 */

import path from 'node:path';
import type { PathOrFolder } from '@ant/shared';
import type { FileSystemPort } from '../ports/filesystem.js';

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

  // Group by parent directory.
  const groups = new Map<string, string[]>();
  for (const p of uniqPaths) {
    const parent = path.posix.dirname(p);
    let bucket = groups.get(parent);
    if (!bucket) {
      bucket = [];
      groups.set(parent, bucket);
    }
    bucket.push(p);
  }

  // Decide which groups compress.
  const compressedFolders = new Map<string, PathOrFolder>();
  for (const [parent, selected] of groups) {
    if (selected.length < 2) continue;
    if (parent === '.' || parent === '' || parent === '/') continue;
    try {
      const entries = await fileSystem.readDirectory(parent);
      const filesInDir = entries
        .filter((e) => !e.isDirectory)
        .map((e) => `${parent}/${e.name}`);
      if (filesInDir.length < 2) continue;
      if (filesInDir.length !== selected.length) continue;
      const selectedSet = new Set(selected);
      if (!filesInDir.every((f) => selectedSet.has(f))) continue;
      compressedFolders.set(parent, {
        kind: 'folder',
        path: parent,
        fileCount: filesInDir.length,
      });
    } catch {
      // Directory not listable — fall through to file emission.
    }
  }

  // Emit in original order; replace compressed folder entries at first occurrence.
  const out: PathOrFolder[] = [];
  const emittedFolders = new Set<string>();
  for (const p of uniqPaths) {
    const parent = path.posix.dirname(p);
    const folderEntry = compressedFolders.get(parent);
    if (folderEntry) {
      if (!emittedFolders.has(parent)) {
        out.push(folderEntry);
        emittedFolders.add(parent);
      }
      continue;
    }
    out.push({ kind: 'file', path: p });
  }
  return out;
}

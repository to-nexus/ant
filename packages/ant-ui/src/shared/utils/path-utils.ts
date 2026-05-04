/**
 * path-utils.ts
 *
 * Utilities for normalizing file/directory path lists.
 */

/** Directory prefix (with trailing slash) and basename for one-line editor headers. */
export interface EditorHeaderPathParts {
  dirWithSlash: string;
  base: string;
}

/**
 * Split a file path into a directory prefix and basename for UI (forward slashes).
 * Empty segments are dropped. Single-segment paths yield an empty `dirWithSlash`.
 */
export function splitPathForEditorHeader(filePath: string): EditorHeaderPathParts {
  const normalized = filePath.replace(/\\/g, '/').trim();
  const segments = normalized.split('/').filter(Boolean);
  if (segments.length === 0) {
    return { dirWithSlash: '', base: filePath };
  }
  if (segments.length === 1) {
    return { dirWithSlash: '', base: segments[0]! };
  }
  const base = segments[segments.length - 1]!;
  const dir = segments.slice(0, -1).join('/');
  return { dirWithSlash: `${dir}/`, base };
}

export interface PathItem {
  path: string;
  type: 'file' | 'directory';
}

/**
 * Normalize a list of paths:
 * 1. Remove exact duplicates (same path)
 * 2. If a directory is in the list, remove any children (files or subdirs) under it
 *
 * @example
 * normalizePaths([
 *   { path: 'architecture', type: 'directory' },
 *   { path: 'architecture/spec/spec-example.md', type: 'file' },
 *   { path: 'architecture/spec', type: 'directory' },
 *   { path: 'plan/prd.md', type: 'file' },
 * ])
 * // => [
 * //   { path: 'architecture', type: 'directory' },
 * //   { path: 'plan/prd.md', type: 'file' },
 * // ]
 */
export function normalizePaths(items: PathItem[]): PathItem[] {
  // 1. Deduplicate by path (last occurrence wins)
  const unique = new Map<string, PathItem>();
  for (const item of items) {
    unique.set(item.path, item);
  }

  // 2. Collect all directory paths
  const dirs = [...unique.values()]
    .filter(i => i.type === 'directory')
    .map(i => i.path);

  // 3. Remove items whose parent directory is already in the list
  return [...unique.values()].filter(item => {
    return !dirs.some(dir => item.path !== dir && item.path.startsWith(dir + '/'));
  });
}

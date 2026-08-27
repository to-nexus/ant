import type { FileNode, UploadFileEntry } from '@/infrastructure/http/api/files';

/**
 * Upload identity is the file's path RELATIVE TO THE TARGET DIRECTORY, not its
 * bare name. A folder upload carries nested entries, so two files named
 * `index.md` under different sub-folders are distinct targets and must not
 * share a conflict verdict or a rename decision.
 */

/** Find uploads whose relative path already exists as a file under dirPath. */
export function findConflicts(
  fileTree: FileNode[],
  dirPath: string,
  entries: UploadFileEntry[],
): string[] {
  const targetDir = findDirectoryNode(fileTree, dirPath);
  if (!targetDir?.children) return [];

  const existing = new Set<string>();
  collectFilePaths(targetDir.children, '', existing);

  return entries
    .map((e) => normalizeRelativePath(e.relativePath))
    .filter((relPath) => existing.has(relPath));
}

/**
 * Generate a unique copy path by appending " (N)" before the extension of the
 * last segment, scanning existingPaths for the next available number.
 *
 * Example: "img/logo.png" -> "img/logo (1).png"
 */
export function getUniqueCopyPath(
  originalPath: string,
  existingPaths: string[],
): string {
  const slashIdx = originalPath.lastIndexOf('/');
  const dir = slashIdx >= 0 ? originalPath.slice(0, slashIdx + 1) : '';
  const name = slashIdx >= 0 ? originalPath.slice(slashIdx + 1) : originalPath;

  const dotIdx = name.lastIndexOf('.');
  const baseName = dotIdx > 0 ? name.slice(0, dotIdx) : name;
  const ext = dotIdx > 0 ? name.slice(dotIdx) : '';

  const pattern = new RegExp(
    `^${escapeRegExp(dir + baseName)} \\((\\d+)\\)${escapeRegExp(ext)}$`,
  );

  let maxN = 0;
  for (const path of existingPaths) {
    const match = path.match(pattern);
    if (match) {
      maxN = Math.max(maxN, parseInt(match[1], 10));
    }
  }

  return `${dir}${baseName} (${maxN + 1})${ext}`;
}

/**
 * Apply per-file conflict resolutions (overwrite or copy) to an upload list.
 * Keys are relative paths — the same identity findConflicts reported.
 */
export function applyPerFileResolutions(
  entries: UploadFileEntry[],
  perFile: Record<string, 'overwrite' | 'copy'>,
  existingPaths: string[],
): UploadFileEntry[] {
  const copyPaths = new Set(
    Object.entries(perFile)
      .filter(([, action]) => action === 'copy')
      .map(([path]) => path),
  );

  if (copyPaths.size === 0) return entries;

  const usedPaths = [...existingPaths];
  return entries.map((entry) => {
    const relPath = normalizeRelativePath(entry.relativePath);
    if (!copyPaths.has(relPath)) return entry;

    const newPath = getUniqueCopyPath(relPath, usedPaths);
    usedPaths.push(newPath);

    const newName = newPath.split('/').pop() || newPath;
    const renamedFile = new File([entry.file], newName, { type: entry.file.type });
    return { file: renamedFile, relativePath: newPath };
  });
}

/**
 * Convert a picked FileList to UploadFileEntry[]. A folder pick
 * (`webkitdirectory`) carries `webkitRelativePath` — that IS the structure the
 * upload must preserve, so it wins over the bare name.
 */
export function fileListToEntries(files: FileList): UploadFileEntry[] {
  return Array.from(files).map((f) => ({
    file: f,
    relativePath: normalizeRelativePath(f.webkitRelativePath || f.name),
  }));
}

/**
 * Every descendant path under dirPath (files and directories), relative to it —
 * the namespace a copy-renamed upload must not collide with.
 */
export function getAllExistingPaths(
  fileTree: FileNode[],
  dirPath: string,
): string[] {
  const targetDir = findDirectoryNode(fileTree, dirPath);
  if (!targetDir?.children) return [];

  const out: string[] = [];
  const walk = (nodes: FileNode[], prefix: string) => {
    for (const node of nodes) {
      const rel = prefix ? `${prefix}/${node.name}` : node.name;
      out.push(rel);
      if (node.children) walk(node.children, rel);
    }
  };
  walk(targetDir.children, '');
  return out;
}

// ── Internal helpers ─────────────────────────────────────────────────

export function normalizeRelativePath(relativePath: string): string {
  return relativePath.replace(/\\/g, '/').replace(/^\.\//, '');
}

function collectFilePaths(nodes: FileNode[], prefix: string, out: Set<string>): void {
  for (const node of nodes) {
    const rel = prefix ? `${prefix}/${node.name}` : node.name;
    if (node.type === 'file') out.add(rel);
    else if (node.children) collectFilePaths(node.children, rel, out);
  }
}

function findDirectoryNode(
  nodes: FileNode[],
  dirPath: string,
): FileNode | undefined {
  // '' / '.' address the tree root itself (writable-root mounts).
  if (dirPath === '' || dirPath === '.') return { name: '', path: '', type: 'directory', children: nodes };
  for (const node of nodes) {
    if (node.path === dirPath && node.type === 'directory') return node;
    if (node.children) {
      const found = findDirectoryNode(node.children, dirPath);
      if (found) return found;
    }
  }
  return undefined;
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

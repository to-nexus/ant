import type { FileNode, UploadFileEntry } from '@/infrastructure/http/api/files';

/**
 * Find files from an upload list that already exist in the target directory.
 * Returns the list of conflicting file names (relative to dirPath).
 */
export function findConflicts(
  fileTree: FileNode[],
  dirPath: string,
  files: FileList | UploadFileEntry[],
): string[] {
  const targetDir = findDirectoryNode(fileTree, dirPath);
  if (!targetDir?.children) return [];

  const existingNames = new Set(
    targetDir.children
      .filter((n) => n.type === 'file')
      .map((n) => n.name),
  );

  const uploadNames = getUploadFileNames(files);
  return uploadNames.filter((name) => existingNames.has(name));
}

/**
 * Generate a unique copy name by appending " (N)" before the extension.
 * Scans existingNames to find the next available number.
 *
 * Example: "design.png" -> "design (1).png", "design (2).png", ...
 */
export function getUniqueCopyName(
  originalName: string,
  existingNames: string[],
): string {
  const dotIdx = originalName.lastIndexOf('.');
  const baseName = dotIdx > 0 ? originalName.slice(0, dotIdx) : originalName;
  const ext = dotIdx > 0 ? originalName.slice(dotIdx) : '';

  const pattern = new RegExp(
    `^${escapeRegExp(baseName)} \\((\\d+)\\)${escapeRegExp(ext)}$`,
  );

  let maxN = 0;
  for (const name of existingNames) {
    const match = name.match(pattern);
    if (match) {
      maxN = Math.max(maxN, parseInt(match[1], 10));
    }
  }

  return `${baseName} (${maxN + 1})${ext}`;
}

/**
 * Rename conflicting files in an upload list to unique copy names.
 * Returns a new UploadFileEntry[] with renamed files where conflicts exist.
 */
export function renameConflictingFiles(
  files: UploadFileEntry[],
  conflicts: string[],
  existingNames: string[],
): UploadFileEntry[] {
  const conflictSet = new Set(conflicts);
  const usedNames = [...existingNames];

  return files.map((entry) => {
    const fileName = entry.relativePath.split('/').pop() || entry.relativePath;
    if (!conflictSet.has(fileName)) return entry;

    const newName = getUniqueCopyName(fileName, usedNames);
    usedNames.push(newName);

    const pathParts = entry.relativePath.split('/');
    pathParts[pathParts.length - 1] = newName;

    const renamedFile = new File([entry.file], newName, { type: entry.file.type });
    return { file: renamedFile, relativePath: pathParts.join('/') };
  });
}

/**
 * Apply per-file conflict resolutions (overwrite or copy) to an upload list.
 * Files marked 'overwrite' pass through unchanged; files marked 'copy' get renamed.
 */
export function applyPerFileResolutions(
  files: UploadFileEntry[],
  perFile: Record<string, 'overwrite' | 'copy'>,
  existingNames: string[],
): UploadFileEntry[] {
  const copyFiles = new Set(
    Object.entries(perFile)
      .filter(([, action]) => action === 'copy')
      .map(([name]) => name),
  );

  if (copyFiles.size === 0) return files;

  const usedNames = [...existingNames];
  return files.map((entry) => {
    const fileName = entry.relativePath.split('/').pop() || entry.relativePath;
    if (!copyFiles.has(fileName)) return entry;

    const newName = getUniqueCopyName(fileName, usedNames);
    usedNames.push(newName);

    const pathParts = entry.relativePath.split('/');
    pathParts[pathParts.length - 1] = newName;

    const renamedFile = new File([entry.file], newName, { type: entry.file.type });
    return { file: renamedFile, relativePath: pathParts.join('/') };
  });
}

/**
 * Convert FileList to UploadFileEntry[] for uniform handling.
 */
export function fileListToEntries(files: FileList): UploadFileEntry[] {
  return Array.from(files).map((f) => ({ file: f, relativePath: f.name }));
}

// ── Internal helpers ─────────────────────────────────────────────────

function findDirectoryNode(
  nodes: FileNode[],
  dirPath: string,
): FileNode | undefined {
  for (const node of nodes) {
    if (node.path === dirPath && node.type === 'directory') return node;
    if (node.children) {
      const found = findDirectoryNode(node.children, dirPath);
      if (found) return found;
    }
  }
  return undefined;
}

function getUploadFileNames(files: FileList | UploadFileEntry[]): string[] {
  if ('length' in files && !Array.isArray(files)) {
    return Array.from(files as FileList).map((f) => f.name);
  }
  return (files as UploadFileEntry[]).map(
    (e) => e.relativePath.split('/').pop() || e.relativePath,
  );
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Collect all file names in a directory (including copy-pattern names)
 * for accurate next-number calculation.
 */
export function getAllExistingNames(
  fileTree: FileNode[],
  dirPath: string,
): string[] {
  const targetDir = findDirectoryNode(fileTree, dirPath);
  if (!targetDir?.children) return [];
  return targetDir.children.map((n) => n.name);
}

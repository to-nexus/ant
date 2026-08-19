/**
 * Folder-pick → definition-path mapping for directory-unit uploads
 * (agent / job / intent). The picked folder's own name is the id, so its
 * segment is stripped and the remainder re-rooted under the destination.
 */

import type { CustomAgentDefinitionFileNode } from '@ant/shared';
import type { UploadFileEntry } from '@/infrastructure/http/api/files';

const relPathOf = (file: File): string =>
  ((file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name).replace(/\\/g, '/');

/** The single top-level folder of a directory pick, or null when ambiguous. */
export function pickedFolderName(files: FileList): string | null {
  const tops = new Set(
    Array.from(files)
      .map((f) => relPathOf(f).replace(/^\/+/, '').split('/')[0])
      .filter(Boolean),
  );
  return tops.size === 1 ? [...tops][0] : null;
}

export function entriesUnder(files: FileList, destDir: string): UploadFileEntry[] {
  return Array.from(files)
    .map((file) => {
      const rest = relPathOf(file).replace(/^\/+/, '').split('/').slice(1).join('/');
      return rest ? { file, relativePath: `${destDir}/${rest}` } : null;
    })
    .filter((e): e is UploadFileEntry => e != null);
}

export function hasEntry(entries: UploadFileEntry[], path: string): boolean {
  return entries.some((e) => e.relativePath === path);
}

export function findDefinitionNode(
  tree: CustomAgentDefinitionFileNode[],
  path: string,
): CustomAgentDefinitionFileNode | undefined {
  for (const node of tree) {
    if (node.path === path) return node;
    const found = node.children ? findDefinitionNode(node.children, path) : undefined;
    if (found) return found;
  }
  return undefined;
}

export const dirOf = (path: string): string => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');

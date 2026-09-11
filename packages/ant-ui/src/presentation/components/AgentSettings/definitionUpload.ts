/**
 * Pick → definition-path mapping for directory-unit uploads (agent / job /
 * intent). The picked folder's own name is the id, so its segment is stripped
 * and the remainder re-rooted under the destination.
 *
 * Input is `UploadFileEntry[]`, not a `FileList`: a drag-and-drop carries no
 * `webkitRelativePath`, and one shape for both sources is what keeps the drop
 * and the picker from disagreeing about where a file was meant to land.
 */

import type { CustomAgentDefinitionFileNode } from '@ant/shared';
import type { UploadFileEntry } from '@/infrastructure/http/api/files';

const relPathOf = (entry: UploadFileEntry): string =>
  entry.relativePath.replace(/\\/g, '/').replace(/^\/+/, '');

/** The single top-level folder of a directory pick, or null when ambiguous. */
export function pickedFolderName(entries: UploadFileEntry[]): string | null {
  const tops = new Set(entries.map((e) => relPathOf(e).split('/')[0]).filter(Boolean));
  return tops.size === 1 ? [...tops][0] : null;
}

export function entriesUnder(entries: UploadFileEntry[], destDir: string): UploadFileEntry[] {
  return entries
    .map((entry) => {
      const rest = relPathOf(entry).split('/').slice(1).join('/');
      return rest ? { file: entry.file, relativePath: `${destDir}/${rest}` } : null;
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

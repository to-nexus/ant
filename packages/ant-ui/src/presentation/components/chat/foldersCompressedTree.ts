import type { DirEntry, FileNode, ListDir } from '@ant/shared';

/**
 * Sync `listDir` over the in-memory `fileTree`, feeding the shared
 * `compressPathsByFolderCore` so the live chat-input preview collapses
 * directory selections with the SAME algorithm the BE uses for the durable
 * record. Returns the immediate children of `dir`, or `null` if `dir` is not
 * a directory node in the tree.
 */
export function makeTreeListDir(fileTree: readonly FileNode[]): ListDir {
  return (dir: string): readonly DirEntry[] | null => {
    let nodes: readonly FileNode[] = fileTree;
    for (const part of dir.split('/')) {
      const found = nodes.find(n => n.name === part);
      if (!found || found.type !== 'directory' || !found.children) return null;
      nodes = found.children;
    }
    return nodes.map(n => ({ name: n.name, isDirectory: n.type === 'directory' }));
  };
}

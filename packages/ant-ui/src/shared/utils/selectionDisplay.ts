import { compressPathsByFolderCore } from '@ant/shared';
import type { DirEntry, FileNode, ListDir, PathOrFolder } from '@ant/shared';

/**
 * Rendering SSOT for a selected artifact path.
 *
 * `actionMetadata.refs` / `.context` / `.target` are the selection SSOT; this
 * is the one shape every surface renders them as. Both consumers — the chat
 * badge row (`ActionMetadataBadges`) and the action-tab config panel
 * (`ActionConfigView`) — derive it from here so a folder selection reads
 * identically in both places instead of each inventing its own collapse rule.
 */
export interface SelectedEntry {
  isFolder: boolean;
  /** Basename, suffixed with `/` for a folder. */
  display: string;
  /** Total file count when `isFolder` — drives the `(N files)` suffix. */
  fileCount?: number;
  /** Original path; `folder` kind uses the directory path (no trailing slash). */
  rawPath: string;
}

/** Locate a node by its addressable `path` (NOT by a chain of display names —
 * a graft may label a row differently from its path segment). */
function findNode(fileTree: readonly FileNode[], target: string): FileNode | null {
  for (const n of fileTree) {
    if (n.path === target) return n;
    if (n.children && (target === n.path || target.startsWith(`${n.path}/`))) {
      const hit = findNode(n.children, target);
      if (hit) return hit;
    }
  }
  return null;
}

/**
 * Sync `listDir` over the in-memory `fileTree`, feeding the shared
 * `compressPathsByFolderCore` so a live FE preview collapses directory
 * selections with the SAME algorithm the BE uses for the durable record.
 * Returns the immediate children of `dir`, or `null` if `dir` is not a
 * directory node in the tree.
 */
export function makeTreeListDir(fileTree: readonly FileNode[]): ListDir {
  return (dir: string): readonly DirEntry[] | null => {
    const found = findNode(fileTree, dir);
    if (!found || found.type !== 'directory' || !found.children) return null;
    return found.children.map(n => ({ name: n.name, isDirectory: n.type === 'directory' }));
  };
}

/** Is this path a directory in the rendered tree? The folder-select gesture
 * commits a bare directory path (no trailing `/`), which `describePath` alone
 * cannot tell from a file — so the chip row asks the tree. */
export function isDirectoryInTree(fileTree: readonly FileNode[], p: string): boolean {
  return findNode(fileTree, p.replace(/\/+$/, ''))?.type === 'directory';
}

function describePath(p: string): { isFolder: boolean; display: string } {
  const isFolder = p.endsWith('/');
  if (isFolder) {
    const stripped = p.replace(/\/+$/, '');
    const tail = stripped.split('/').pop() || stripped;
    return { isFolder: true, display: `${tail}/` };
  }
  return { isFolder: false, display: p.split('/').pop() || p };
}

export function entryFromCompressed(e: PathOrFolder): SelectedEntry {
  if (e.kind === 'folder') {
    const tail = e.path.split('/').pop() || e.path;
    return { isFolder: true, display: `${tail}/`, fileCount: e.fileCount, rawPath: e.path };
  }
  const { isFolder, display } = describePath(e.path);
  return { isFolder, display, rawPath: e.path };
}

export function entryFromPath(p: string): SelectedEntry {
  const { isFolder, display } = describePath(p);
  return { isFolder, display, rawPath: p };
}

/**
 * Prefer the BE-supplied `foldersCompressed` view; fall back to the raw
 * `string[]` slot for pre-`foldersCompressed` records and clients that never
 * go through the compression path (tests, legacy chat.jsonl tails).
 */
export function resolveSelectedEntries(
  compressed: ReadonlyArray<PathOrFolder> | undefined,
  fallback: readonly string[] | undefined,
): SelectedEntry[] {
  if (compressed?.length) return compressed.map(entryFromCompressed);
  if (fallback?.length) return fallback.map(entryFromPath);
  return [];
}

/**
 * Compress a raw selection against the in-memory tree. Used where no
 * `foldersCompressed` view exists (the action-tab panel, the live chat input).
 * Without a tree there is nothing to collapse against, so paths pass through
 * uncompressed rather than being dropped.
 */
/** Files under a node, recursively — the `(N)` a folder chip carries. */
function countFiles(node: FileNode): number {
  if (node.type === 'file') return 1;
  return (node.children ?? []).reduce((n, c) => n + countFiles(c), 0);
}

export function compressSelection(
  paths: readonly string[],
  fileTree: readonly FileNode[],
): SelectedEntry[] {
  if (paths.length === 0) return [];
  if (fileTree.length === 0) return paths.map(entryFromPath);
  return compressPathsByFolderCore(paths, makeTreeListDir(fileTree))
    .map(entryFromCompressed)
    .map((e) => {
      // `compressPathsByFolderCore` collapses only when every descendant FILE
      // was individually selected. The folder-select gesture commits the bare
      // directory path instead, which arrives here uncollapsed and — with no
      // trailing slash — reads as a file. Ask the tree.
      if (e.isFolder) return e;
      const node = findNode(fileTree, e.rawPath);
      if (node?.type !== 'directory') return e;
      const tail = e.rawPath.split('/').pop() || e.rawPath;
      return { isFolder: true, display: `${tail}/`, fileCount: countFiles(node), rawPath: e.rawPath };
    });
}

/** Every path a tree can represent — files AND directories. */
export function collectRepresentablePaths(nodes: readonly FileNode[]): Set<string> {
  const out = new Set<string>();
  const walk = (list: readonly FileNode[]): void => {
    for (const n of list) {
      out.add(n.path);
      if (n.children) walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

/**
 * A picker commits its whole selection, replacing the field — so a path the
 * rendered tree cannot show (pruned by workspace domain, or hidden by
 * `excludePatterns`) would be deleted merely by opening the picker and pressing
 * confirm. Same rule as the panel's `added` group: a surface that cannot
 * display something must not delete it. Carry those paths through untouched.
 *
 * Single-select pickers are exempt — preserving a hidden path there would emit
 * two values for a field that accepts one.
 */
export function preserveHiddenSelections(
  confirmed: readonly string[],
  initialSelected: readonly string[],
  representable: ReadonlySet<string>,
): string[] {
  const committed = new Set(confirmed);
  const hidden = initialSelected.filter(p => !representable.has(p) && !committed.has(p));
  return hidden.length > 0 ? [...confirmed, ...hidden] : [...confirmed];
}

/**
 * Remove one rendered entry from a selection. A folder entry stands for every
 * file under it, so deselecting it must drop the subtree — not just a path that
 * happens to equal the directory. Returns `undefined` when nothing is left, so
 * the result can be handed straight to `updateActionMetadata`.
 */
export function removeSelectedEntry(
  list: readonly string[] | undefined,
  entry: SelectedEntry,
): string[] | undefined {
  const next = (list ?? []).filter(p =>
    entry.isFolder
      ? p !== entry.rawPath && !p.startsWith(entry.rawPath + '/')
      : p !== entry.rawPath,
  );
  return next.length > 0 ? next : undefined;
}

/**
 * Mention typeahead rows for the file-addressing prefixes (`@target:` /
 * `@ref:` / `@ctx:`), built as DIRECTORY NAVIGATION over the picker tree —
 * one level at a time, like an editor's `@` file picker — rather than a flat
 * ranked list of every path.
 *
 * Pure (no store, no React) so the ranking, the per-level cap and the
 * selectable/enterable rules are table-testable. The hook owns the mechanism
 * (query parsing, keyboard, store writes); this module owns the rows.
 */

import type { FileNode } from '@ant/shared';

export interface MentionSuggestion {
  /**
   * Which field a pick ARMS. `agentCtx` / `pipelineCtx` arm the same
   * `context[]` slot as `context` — the distinct types exist so the row can
   * carry a definition icon and an owner breadcrumb instead of a raw mount
   * path. `browse` opens the folder-tree picker for the field in `id`.
   */
  type: 'intent' | 'target' | 'ref' | 'context' | 'agentCtx' | 'pipelineCtx' | 'explicit' | 'plan' | 'command' | 'browse';
  id: string;
  label: string;
  description?: string;
  /** ★ marker — the path lies under one of the armed intent's slot directories. */
  group?: 'suggested';
  nodeType?: 'file' | 'directory';
  /** A directory the user may descend into (Tab / →). */
  enterable?: boolean;
  /** Enter / click attaches it. Directories are attachable as folder units on
   * `@ref:` / `@ctx:`, never on `@target:`; the `_agents` / `_pipelines`
   * group roots are never attachable. */
  selectable?: boolean;
}

export interface NavQuery {
  /** Up to and including the last `/`; `''` at the root. */
  dirPrefix: string;
  /** What the user typed at this level — the filter. */
  remainder: string;
}

export function splitNavQuery(query: string): NavQuery {
  const idx = query.lastIndexOf('/');
  if (idx < 0) return { dirPrefix: '', remainder: query };
  return { dirPrefix: query.slice(0, idx + 1), remainder: query.slice(idx + 1) };
}

/** `_agents/payments-ops/` → `_agents/`; `_agents/` → `''`; a root query → `''`. */
export function popNavLevel(query: string): string {
  const dir = splitNavQuery(query).dirPrefix.replace(/\/$/, '');
  const idx = dir.lastIndexOf('/');
  return idx < 0 ? '' : dir.slice(0, idx + 1);
}

function findDir(tree: FileNode[], dirPath: string): FileNode | null {
  for (const node of tree) {
    if (node.type !== 'directory') continue;
    if (node.path === dirPath) return node;
    if (dirPath.startsWith(node.path + '/') && node.children) {
      const hit = findDir(node.children, dirPath);
      if (hit) return hit;
    }
  }
  return null;
}

/**
 * Children of the directory at `dirPrefix`, or null when no such directory.
 * Keyed on `node.path`, never on a chain of `node.name` — the definition
 * grafts label rows with display names that differ from the path segment.
 */
export function findDirNode(tree: FileNode[], dirPrefix: string): FileNode[] | null {
  const dirPath = dirPrefix.replace(/\/$/, '');
  if (dirPath === '') return tree;
  const dir = findDir(tree, dirPath);
  return dir ? (dir.children ?? []) : null;
}

/** Display names of the directories along `dirPrefix` (path segment when the node is unknown). */
export function navBreadcrumb(tree: FileNode[], dirPrefix: string): string[] {
  const dirPath = dirPrefix.replace(/\/$/, '');
  if (dirPath === '') return [];
  const segments = dirPath.split('/');
  return segments.map((seg, i) => findDir(tree, segments.slice(0, i + 1).join('/'))?.name ?? seg);
}

export interface NavSuggestionOptions {
  field: 'target' | 'ref' | 'context';
  selectableTypes: ReadonlyArray<'file' | 'directory'>;
  /** May this node be attached? A directory is SHOWN when it or any descendant is offered. */
  isOffered: (node: FileNode) => boolean;
  /** The armed intent's slot directories — rows on their path get the ★ and sort first. */
  suggestedDirs?: string[];
  /** Rows per level before the "N more" row. */
  perLevelCap?: number;
  /** Per-row overrides (type / description) — the universal mounts use it. */
  rowFor?: (node: FileNode) => Partial<MentionSuggestion>;
  labels: { browse: string; browseDescription: string; more: (n: number) => string };
}

const DEFAULT_PER_LEVEL_CAP = 12;

/** The `browse` row's id is the picker field — `ref` arms `refs`. */
export function browseIdForField(field: NavSuggestionOptions['field']): 'target' | 'refs' | 'context' {
  return field === 'ref' ? 'refs' : field;
}

function basename(path: string): string {
  return path.split('/').pop() || path;
}

function hasOfferedDescendant(node: FileNode, isOffered: (n: FileNode) => boolean): boolean {
  for (const child of node.children ?? []) {
    if (isOffered(child)) return true;
    if (child.type === 'directory' && hasOfferedDescendant(child, isOffered)) return true;
  }
  return false;
}

function onSuggestedPath(path: string, suggestedDirs: string[]): boolean {
  return suggestedDirs.some(dir => dir === path || dir.startsWith(path + '/') || path.startsWith(dir + '/'));
}

function matches(node: FileNode, remainder: string): boolean {
  if (remainder === '') return true;
  const q = remainder.toLowerCase();
  return node.name.toLowerCase().includes(q) || basename(node.path).toLowerCase().includes(q);
}

function byRank(a: { suggested: boolean; label: string }, b: { suggested: boolean; label: string }): number {
  if (a.suggested !== b.suggested) return a.suggested ? -1 : 1;
  return a.label.localeCompare(b.label, undefined, { sensitivity: 'base' });
}

export function buildNavSuggestions(tree: FileNode[], query: string, opts: NavSuggestionOptions): MentionSuggestion[] {
  const { dirPrefix, remainder } = splitNavQuery(query);
  const browseRow: MentionSuggestion = {
    type: 'browse',
    id: browseIdForField(opts.field),
    label: opts.labels.browse,
    description: opts.labels.browseDescription,
  };
  const level = findDirNode(tree, dirPrefix);
  if (!level) return [browseRow];

  const suggestedDirs = opts.suggestedDirs ?? [];
  const cap = opts.perLevelCap ?? DEFAULT_PER_LEVEL_CAP;
  const dirs: Array<{ row: MentionSuggestion; suggested: boolean; label: string }> = [];
  const files: typeof dirs = [];

  for (const node of level) {
    if (!matches(node, remainder)) continue;
    const isDir = node.type === 'directory';
    const offered = opts.isOffered(node);
    if (!offered && !(isDir && hasOfferedDescendant(node, opts.isOffered))) continue;
    const suggested = suggestedDirs.length > 0 && onSuggestedPath(node.path, suggestedDirs);
    const row: MentionSuggestion = {
      type: opts.field,
      id: node.path,
      label: node.name,
      description: isDir ? `${node.path}/` : node.path,
      ...(suggested ? { group: 'suggested' as const } : {}),
      nodeType: node.type,
      enterable: isDir,
      selectable: offered && opts.selectableTypes.includes(node.type),
      ...opts.rowFor?.(node),
    };
    (isDir ? dirs : files).push({ row, suggested, label: node.name });
  }

  dirs.sort(byRank);
  files.sort(byRank);
  const ranked = [...dirs, ...files].map(r => r.row);
  const out = ranked.slice(0, cap);
  if (ranked.length > cap) {
    out.push({ ...browseRow, label: opts.labels.more(ranked.length - cap) });
  }
  out.push(browseRow);
  return out;
}

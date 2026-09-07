/**
 * Source-tree shaping for the transfer Send tab — pure, per project kind.
 *
 * - canonical (codespace): only the UI-visible canonical top-level dirs
 *   (`plan` / `architecture` / `visual` / `assets` / `meta`), then the
 *   workspace-domain prune, exactly as the codespace ArtifactsPanel shows them.
 * - universal (workspace): every user-created top-level dir minus the reserved
 *   grafts (`sessions` / `pipeline-runs` / `_agents` / `_pipelines`); there is
 *   no allowlist and no domain prune — the workspace tree is free-form.
 */

import {
  UI_VISIBLE_TOP_LEVEL_DIRS,
  UNIVERSAL_FEATURE,
  UNIVERSAL_RESERVED_ROOT_DIRNAMES,
  pruneFileTreeForWorkspaceDomain,
  type Domain,
  type FileNode,
} from '@ant/shared';

export interface TransferSourceTreeOptions {
  /** Absent = canonical. */
  projectType?: 'canonical' | 'universal';
  domain?: Domain | null;
}

const CANONICAL_ALLOWED_TOP_LEVEL = new Set<string>(UI_VISIBLE_TOP_LEVEL_DIRS.map((d) => d.name));

export function filterTransferSourceTree(tree: FileNode[], opts: TransferSourceTreeOptions): FileNode[] {
  if (opts.projectType === 'universal') {
    return tree.filter((node) => !UNIVERSAL_RESERVED_ROOT_DIRNAMES.includes(node.name));
  }
  const allowed = tree.filter((node) => CANONICAL_ALLOWED_TOP_LEVEL.has(node.name));
  return pruneFileTreeForWorkspaceDomain(allowed, opts.domain ?? 'service');
}

/**
 * The feature a destination picker should pre-select, or null when the user
 * must choose: a workspace project offers exactly one pseudo-feature.
 */
export function autoSelectFeature(features: ReadonlyArray<{ featureId: string }>): string | null {
  return features.length === 1 && features[0].featureId === UNIVERSAL_FEATURE ? UNIVERSAL_FEATURE : null;
}

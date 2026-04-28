/**
 * Canonical Feature Directories (Frontend)
 *
 * All canonical definitions originate from @ant/shared/canonical.ts.
 * This module re-exports them and adds frontend-only derived utilities.
 */

export { getArtifactDirPolicy, validateFileForDir, isCanonicalDir } from '@ant/shared';
export type { ArtifactDirPolicy } from '@ant/shared';

import { CANONICAL_FEATURE_DIRS } from '@ant/shared';

const CANONICAL_FEATURE_DIRS_SET = new Set(CANONICAL_FEATURE_DIRS);

/**
 * Pre-computed set of canonical dirs that have canonical children.
 * User content should NOT be created directly in these — only canonical subdirs belong here.
 */
const STRUCTURAL_CANONICAL_DIRS: ReadonlySet<string> = (() => {
  const result = new Set<string>();
  for (const dir of CANONICAL_FEATURE_DIRS) {
    const lastSlash = dir.lastIndexOf('/');
    if (lastSlash > 0) {
      const parent = dir.slice(0, lastSlash);
      if (CANONICAL_FEATURE_DIRS_SET.has(parent)) {
        result.add(parent);
      }
    }
  }
  return result;
})();

/**
 * Returns true for canonical directories that have canonical subdirectories.
 * File/folder creation and uploads should be blocked in these — they only hold canonical children.
 * e.g. `architecture`, `visual`, `visual/ui`, `meta`, `meta/evals`, `sessions/architect`.
 */
export function isStructuralCanonicalDir(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, '/').replace(/\/$/, '');
  return STRUCTURAL_CANONICAL_DIRS.has(normalized);
}

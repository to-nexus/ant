/**
 * Canonical Feature Directories (Frontend)
 *
 * All canonical definitions originate from @ant/shared/canonical.ts.
 * This module re-exports them and adds frontend-only derived utilities.
 */

export { getArtifactDirPolicy, validateFileForDir, isCanonicalDir } from '@ant/shared';
export type { ArtifactDirPolicy } from '@ant/shared';

import { CANONICAL_FEATURE_DIRS } from '@ant/shared';
import {
  ACCENT_VAR,
  type SectionAccent,
} from '@/presentation/components/layout/Explorer/SectionShell';

export type { SectionAccent };

/**
 * Single source of truth for domain → SectionShell accent mapping.
 *
 * Consumed by both:
 *   - SectionShell's `accent` prop (palette: violet/pink/orange/cool)
 *   - The folder-icon CSS variable tint at the top-level domain row
 *     (derived via {@link getDomainAccentColor}).
 *
 * Adding a new domain requires editing this record ONLY — the icon
 * tint follows automatically through ACCENT_VAR. See spec §5 T4 / G4.
 */
export const DOMAIN_ACCENT_MAP: Record<string, SectionAccent> = {
  plan: 'violet',
  system: 'pink',
  spec: 'orange',
  ui: 'pink',
  'game-art': 'orange',
  data: 'cool',
  assets: 'cool',
  meta: 'violet',
  sessions: 'cool',
  architecture: 'pink',
  visual: 'orange',
};

/**
 * Resolves a top-level domain key to its folder-icon CSS variable
 * string (e.g. `'var(--violet-500)'`).
 *
 * Returns `undefined` for unknown domain keys — matches the legacy
 * behavior of indexing into the prior `DOMAIN_ACCENT` lookup table.
 */
export function getDomainAccentColor(domain: string): string | undefined {
  const accent = DOMAIN_ACCENT_MAP[domain];
  return accent ? ACCENT_VAR[accent] : undefined;
}

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

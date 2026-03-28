/**
 * Codebase Path Normalizer
 * 
 * Single source of truth for normalizing file paths to be under the codebase directory.
 * 
 * Used by:
 * - Tool handlers (resolveToolPath) for read operations
 * - FileRenderer (resolveFileSystemPath) for write operations
 * - FileRegistry for existence checks
 * - CodeGen for tracking created file paths
 * 
 * KEY PRINCIPLES:
 * - NEVER strip intermediate directories (src/, lib/, etc.)
 * - Feature workspace structure: codebase/ | inputs/ | outputs/ | sessions/
 *   Any path not under a sibling directory belongs to codebase/.
 */

import { CANONICAL_FEATURE_DIRS } from '@ant/shared';

/**
 * Normalize path separators and remove leading ./ or /
 */
export function normalizeRelPath(s: string): string {
  return s.replace(/\\/g, '/').replace(/^\.?\//, '').trim();
}

export interface PathNormalizationResult {
  /** The normalized path (guaranteed to be under codebaseRel/ if matched) */
  normalized: string;
  /** Whether the path was modified */
  wasFixed: boolean;
  /** Human-readable reason for the fix */
  reason?: string;
}

/**
 * Feature workspace sibling directory prefixes (derived from CANONICAL_FEATURE_DIRS).
 * 
 * Feature workspace structure:
 *   features/{feature}/
 *   ├── codebase/    <- code files (handled by Rule 1)
 *   ├── inputs/      <- input materials, assets
 *   ├── outputs/     <- generated artifacts
 *   └── sessions/    <- session state
 * 
 * Paths starting with these prefixes are NOT codebase files
 * and must not be auto-corrected.
 */
const FEATURE_SIBLING_PREFIXES = [
  ...new Set(CANONICAL_FEATURE_DIRS.map(d => d.split('/')[0]))
].map(d => d + '/');

/**
 * Normalize a file path to ensure it's under the codebase directory.
 * 
 * Rules (applied in order, first match wins):
 * 1. Already starts with codebaseRel/ -> no change
 *    1.5. Double-nested codebaseRel/codebaseRel/... -> collapse to codebaseRel/...
 * 2. features/<name>/<codebaseRel>/... -> codebaseRel/... (fix LLM nesting mistake)
 * 3. Starts with a feature sibling directory (inputs/, outputs/, sessions/) -> no change
 * 4. Everything else -> prepend codebaseRel/ (it's a codebase file missing the prefix)
 * 
 * CRITICAL: This function NEVER strips path components (e.g., src/).
 * Stripping src/ causes read/write path mismatches that lead to duplicate files.
 * 
 * @param rawPath - File path (may contain backslashes, leading ./ etc.)
 * @param codebaseRel - Codebase directory relative to workspace root (default: 'codebase')
 */
export function normalizeToCodebasePath(
  rawPath: string,
  codebaseRel: string = 'codebase',
): PathNormalizationResult {
  const normalized = normalizeRelPath(rawPath);
  const prefix = codebaseRel.endsWith('/') ? codebaseRel : codebaseRel + '/';

  // Rule 1: Already under codebase directory
  if (normalized.startsWith(prefix) || normalized === codebaseRel) {
    // Rule 1.5: Collapse double-nesting (codebase/codebase/... → codebase/...)
    // Caused by CWD mismatch: when cwd=codebase/ and command uses codebase/ prefix,
    // or when LLM reads a double-nested path and propagates it.
    const doublePrefix = prefix + codebaseRel + '/';
    if (normalized.startsWith(doublePrefix)) {
      const collapsed = normalized.slice(prefix.length);
      console.warn(`⚠️  [PATH FIX] Collapsed double-nested codebase path: ${normalized} → ${collapsed}`);
      return {
        normalized: collapsed,
        wasFixed: true,
        reason: `collapsed double-nested ${codebaseRel}/ prefix`,
      };
    }
    return { normalized, wasFixed: false };
  }

  // Rule 2: features/<feature>/codebase/... -> codebase/...
  // LLM sometimes nests codebase inside the features directory
  const escapedRel = codebaseRel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const featurePattern = new RegExp(`^features/[^/]+/${escapedRel}/(.+)$`);
  const featureMatch = normalized.match(featurePattern);
  if (featureMatch) {
    return {
      normalized: `${prefix}${featureMatch[1]}`,
      wasFixed: true,
      reason: `Stripped redundant features/ prefix from codebase path`,
    };
  }

  // Rule 3: Feature sibling directory (inputs/, outputs/, sessions/) -> no change
  // These are legitimate non-codebase paths (e.g., inputs/assets/logo.png for copy operations)
  for (const siblingPrefix of FEATURE_SIBLING_PREFIXES) {
    if (normalized.startsWith(siblingPrefix)) {
      return { normalized, wasFixed: false };
    }
  }

  // Rule 4: Everything else belongs under codebase/
  // This covers ALL languages and file types without maintaining an allowlist.
  return {
    normalized: `${prefix}${normalized}`,
    wasFixed: true,
    reason: `all code files belong under ${codebaseRel}/`,
  };
}

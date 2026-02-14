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
 * KEY PRINCIPLE: NEVER strip intermediate directories (src/, lib/, etc.)
 * They are valid project structure elements.
 */

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
 * Directories commonly found at the root of a codebase.
 * If a path starts with one of these, it should be under the codebase directory.
 * 
 * IMPORTANT: src/ is included here. It is a VALID project directory
 * and must NEVER be stripped from paths.
 */
const CODEBASE_ROOT_DIRS = [
  'app/', 'src/', 'components/', 'public/', 'styles/', 'lib/', 'utils/',
  'hooks/', 'pages/', 'frontend/', 'packages/', 'backend/', 'server/',
  'api/', 'shared/', 'common/', 'core/',
];

/** Common config files that should be under the codebase directory */
const CODEBASE_CONFIG_FILES = [
  'package.json', 'tsconfig.json', 'next.config', 'tailwind.config',
  'postcss.config', '.eslintrc', '.gitignore',
];

/**
 * Normalize a file path to ensure it's under the codebase directory.
 * 
 * Rules (applied in order, first match wins):
 * 1. Already starts with codebaseRel/ -> no change
 * 2. features/<name>/<codebaseRel>/... -> codebaseRel/... (fix LLM nesting mistake)
 * 3. Starts with known code dir (app/, src/, lib/, etc.) -> prepend codebaseRel/
 * 4. Is a known config file -> prepend codebaseRel/
 * 5. Otherwise -> no change (might be features/ path or other valid location)
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

  // Rule 1: Already under codebase directory - no change needed
  if (normalized.startsWith(prefix) || normalized === codebaseRel) {
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
      reason: `${codebaseRel}/ is at project root, not inside features/`,
    };
  }

  // Rule 3: Known code directory -> prepend codebase/
  // This includes src/ - which is a VALID directory that must be preserved, not stripped.
  for (const dir of CODEBASE_ROOT_DIRS) {
    if (normalized.startsWith(dir)) {
      return {
        normalized: `${prefix}${normalized}`,
        wasFixed: true,
        reason: `code files must be under ${codebaseRel}/`,
      };
    }
  }

  // Rule 4: Known config files -> prepend codebase/
  for (const configFile of CODEBASE_CONFIG_FILES) {
    if (normalized === configFile || normalized.startsWith(`${configFile.split('.')[0]}.`)) {
      return {
        normalized: `${prefix}${normalized}`,
        wasFixed: true,
        reason: `config files are inside ${codebaseRel}/`,
      };
    }
  }

  // Rule 5: No matching pattern - return as-is
  return { normalized, wasFixed: false };
}

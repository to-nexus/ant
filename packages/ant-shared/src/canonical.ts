/**
 * Canonical Feature Structure Definitions (Single Source of Truth)
 *
 * Every canonical directory and file is defined ONCE here with a visibility tag.
 * All derived constants (full path lists, UI-visible subsets, lookup sets)
 * are computed from these arrays — no manual sync needed.
 *
 * Visibility tags:
 *   'ui:inputs'  — shown under Inputs section in ArtifactsPanel
 *   'ui:outputs' — shown under Outputs section in ArtifactsPanel
 *   'internal'   — system-only, hidden from artifact UI
 */

type Visibility = 'ui:inputs' | 'ui:outputs' | 'internal';

interface CanonicalDirDef {
  readonly path: string;
  readonly visibility: Visibility;
}

interface CanonicalFileDef {
  readonly path: string;
  readonly visibility: Visibility;
}

// ============================================
// Directory definitions
// ============================================

const CANONICAL_DIR_DEFS: ReadonlyArray<CanonicalDirDef> = [
  // inputs
  { path: 'inputs',                            visibility: 'internal' },
  { path: 'inputs/sources',                    visibility: 'ui:inputs' },
  { path: 'inputs/directives',                 visibility: 'internal' },
  { path: 'inputs/directives/design',          visibility: 'internal' },
  { path: 'inputs/directives/code',            visibility: 'internal' },
  { path: 'inputs/directives/learn',           visibility: 'internal' },
  { path: 'inputs/assets',                     visibility: 'ui:inputs' },
  { path: 'inputs/assets/gen',                 visibility: 'internal' },
  { path: 'inputs/assets/gen/sketches',         visibility: 'internal' },
  { path: 'inputs/references',                 visibility: 'ui:inputs' },
  // outputs
  { path: 'outputs',                           visibility: 'internal' },
  { path: 'outputs/design',                    visibility: 'ui:outputs' },
  { path: 'outputs/design/ui',                 visibility: 'internal' },
  { path: 'outputs/design/system',             visibility: 'internal' },
  { path: 'outputs/design/spec',               visibility: 'internal' },
  { path: 'outputs/evals',                     visibility: 'ui:outputs' },
  { path: 'outputs/evals/prd',                 visibility: 'internal' },
  { path: 'outputs/evals/ui-design',           visibility: 'internal' },
  { path: 'outputs/evals/system-design',       visibility: 'internal' },
  { path: 'outputs/evals/code',                visibility: 'internal' },
  // sessions
  { path: 'sessions',                          visibility: 'internal' },
  { path: 'sessions/architect',                visibility: 'internal' },
  { path: 'sessions/architect/debug',            visibility: 'internal' },
  { path: 'sessions/architect/debug/prompts',    visibility: 'internal' },
  { path: 'sessions/architect/debug/plans',      visibility: 'internal' },
  { path: 'sessions/architect/debug/logs',       visibility: 'internal' },
  { path: 'sessions/architect/debug/tokens',     visibility: 'internal' },
  { path: 'sessions/architect/debug/figma',      visibility: 'internal' },
  { path: 'sessions/architect/runtime',          visibility: 'internal' },
  { path: 'sessions/architect/runtime/design',   visibility: 'internal' },
  { path: 'sessions/architect/runtime/code',     visibility: 'internal' },
  { path: 'sessions/planner',                    visibility: 'internal' },
  { path: 'sessions/planner/debug',              visibility: 'internal' },
  { path: 'sessions/planner/debug/prompts',      visibility: 'internal' },
  { path: 'sessions/creator',                    visibility: 'internal' },
  { path: 'sessions/creator/debug',              visibility: 'internal' },
  { path: 'sessions/creator/debug/prompts',      visibility: 'internal' },
];

// ============================================
// File definitions
// ============================================

const CANONICAL_FILE_DEFS: ReadonlyArray<CanonicalFileDef> = [
  { path: 'inputs/figma.json', visibility: 'ui:inputs' },
];

// ============================================
// Derived: full canonical path lists
// ============================================

export const CANONICAL_FEATURE_DIRS: ReadonlyArray<string> =
  CANONICAL_DIR_DEFS.map(d => d.path);

/** Canonical file relative paths — content factories are defined in sessionPaths.ts (backend-only) */
export const CANONICAL_FEATURE_FILE_PATHS: ReadonlyArray<string> =
  CANONICAL_FILE_DEFS.map(f => f.path);

// ============================================
// Derived: UI-visible child names per section
// ============================================

/** Child dir names shown under Inputs in ArtifactsPanel */
export const UI_VISIBLE_INPUT_DIRS: ReadonlyArray<string> =
  CANONICAL_DIR_DEFS
    .filter(d => d.visibility === 'ui:inputs')
    .map(d => d.path.split('/')[1]);

/** Child dir names shown under Outputs in ArtifactsPanel */
export const UI_VISIBLE_OUTPUT_DIRS: ReadonlyArray<string> =
  CANONICAL_DIR_DEFS
    .filter(d => d.visibility === 'ui:outputs')
    .map(d => d.path.split('/')[1]);

/** Input-level file names shown under Inputs in ArtifactsPanel */
export const UI_VISIBLE_INPUT_FILES: ReadonlyArray<string> =
  CANONICAL_FILE_DEFS
    .filter(f => f.visibility === 'ui:inputs')
    .map(f => f.path.split('/').pop()!);

// ============================================
// Derived: O(1) canonical lookup
// ============================================

const CANONICAL_FEATURE_DIRS_SET = new Set(CANONICAL_FEATURE_DIRS);

export function isCanonicalDir(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, '/').replace(/\/$/, '');
  return CANONICAL_FEATURE_DIRS_SET.has(normalized);
}

// ============================================
// Design subdirectory helpers (Single Source of Truth)
// ============================================

export type DesignSubdir = 'ui' | 'system' | 'spec';

export const DESIGN_SUBDIR = {
  UI: 'ui',
  SYSTEM: 'system',
  SPEC: 'spec',
} as const satisfies Record<string, DesignSubdir>;

export const DESIGN_SUBDIRS: ReadonlyArray<DesignSubdir> = Object.values(DESIGN_SUBDIR);

export const DESIGN_DIR = 'outputs/design' as const;

/**
 * Determine which design subdirectory a file belongs to based on filename.
 *   ui-*.json       → 'ui'
 *   spec-*.md       → 'spec'
 *   everything else → 'system'  (be-system-*, fe-system-*, api-contract-*)
 */
export function designSubdirOf(filename: string): DesignSubdir {
  if (filename.startsWith('ui-') && filename.endsWith('.json')) return 'ui';
  if (filename.startsWith('spec-') && filename.endsWith('.md')) return 'spec';
  return 'system';
}

/**
 * Build the design output directory path for a given filename.
 * Returns e.g. 'outputs/design/system' or 'outputs/design/ui'.
 */
export function designDirOf(filename: string): string {
  return `${DESIGN_DIR}/${designSubdirOf(filename)}`;
}

// ============================================
// Artifact path prefixes (for ArtifactPoolView matching)
// ============================================

export const ARTIFACT_PREFIX = {
  SYSTEM_DESIGN: `${DESIGN_DIR}/system/` as const,
  SPEC: `${DESIGN_DIR}/spec/` as const,
  UI: `${DESIGN_DIR}/ui/` as const,
  UI_SPEC: `${DESIGN_DIR}/ui/spec/` as const,
  DESIGN: `${DESIGN_DIR}/` as const,
  SOURCES: 'inputs/sources' as const,
  API_CONTRACT: `${DESIGN_DIR}/system/api-contract-` as const,
  FE_SYSTEM: `${DESIGN_DIR}/system/fe-system-` as const,
  BE_SYSTEM: `${DESIGN_DIR}/system/be-system-` as const,
} as const;

// ============================================
// Boundary classification (inter-job context bridge)
// ============================================

export const BOUNDARY = {
  HEAVYWEIGHT: 'heavyweight',
  LIGHTWEIGHT: 'lightweight',
} as const;

export type Boundary = typeof BOUNDARY[keyof typeof BOUNDARY];

/** Internal decompose state: pending means "spec exists but no design doc yet". */
export const SUGGESTED_BOUNDARY = {
  ...BOUNDARY,
  PENDING: 'pending',
} as const;

export type SuggestedBoundary = typeof SUGGESTED_BOUNDARY[keyof typeof SUGGESTED_BOUNDARY];

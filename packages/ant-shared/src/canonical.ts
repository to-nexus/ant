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
  // Phase 2 (D19-revised): assets parent stays UI-visible as the
  // container for the per-domain pools. workspace.domain decides which
  // sub-pool is the active routing target (`service/` vs `game/`); the
  // parent itself is subdir-only (see `artifact-dir-policy.ts`).
  { path: 'inputs/assets',                     visibility: 'ui:inputs' },
  { path: 'inputs/assets/service',             visibility: 'internal' },
  { path: 'inputs/assets/service/icons',       visibility: 'internal' },
  { path: 'inputs/assets/service/images',      visibility: 'internal' },
  { path: 'inputs/assets/service/fonts',       visibility: 'internal' },
  { path: 'inputs/assets/service/misc',        visibility: 'internal' },
  { path: 'inputs/assets/game',                visibility: 'internal' },
  { path: 'inputs/assets/game/icons',          visibility: 'internal' },
  { path: 'inputs/assets/game/images',         visibility: 'internal' },
  { path: 'inputs/assets/game/entities',       visibility: 'internal' },
  { path: 'inputs/assets/game/particles',      visibility: 'internal' },
  { path: 'inputs/assets/game/projectiles',    visibility: 'internal' },
  { path: 'inputs/assets/game/sfx',            visibility: 'internal' },
  { path: 'inputs/assets/game/bgm',            visibility: 'internal' },
  { path: 'inputs/assets/game/tilemaps',       visibility: 'internal' },
  { path: 'inputs/assets/game/atlas',          visibility: 'internal' },
  { path: 'inputs/assets/game/models',         visibility: 'internal' },
  { path: 'inputs/assets/gen',                 visibility: 'internal' },
  { path: 'inputs/assets/gen/sketches',         visibility: 'internal' },
  // outputs
  { path: 'outputs',                           visibility: 'internal' },
  { path: 'outputs/design',                    visibility: 'ui:outputs' },
  { path: 'outputs/design/ui',                 visibility: 'internal' },
  { path: 'outputs/design/ui/ant',             visibility: 'internal' },
  { path: 'outputs/design/ui/figma',           visibility: 'internal' },
  { path: 'outputs/design/ui/handoff',         visibility: 'internal' },
  // Phase 2 (D24): game-art is FLAT — no ant/figma/handoff sub-source containers.
  // figma/handoff for game-art deferred to Phase 5+.
  { path: 'outputs/design/game-art',           visibility: 'internal' },
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
  { path: 'outputs/design/ui/figma/figma.json', visibility: 'internal' },
];

/**
 * Canonical path for the figma workfile reference (URL + fileKey + nodeId metadata).
 * This file holds ONLY the reference to the Figma workfile; it never stores
 * any exploration output. design job consumes it to produce ant-ui artifacts
 * at `outputs/design/ui/ant/`, and code job consumes it at runtime via MCP.
 */
export const FIGMA_CONFIG_PATH = 'outputs/design/ui/figma/figma.json' as const;

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

export type DesignSubdir = 'ui' | 'art' | 'system' | 'spec';

export const DESIGN_SUBDIR = {
  UI: 'ui',
  ART: 'art',
  SYSTEM: 'system',
  SPEC: 'spec',
} as const satisfies Record<string, DesignSubdir>;

export const DESIGN_SUBDIRS: ReadonlyArray<DesignSubdir> = Object.values(DESIGN_SUBDIR);

export const DESIGN_DIR = 'outputs/design' as const;

/**
 * Determine which design subdirectory a file belongs to based on filename.
 *   ui-*.json         → 'ui'   (will be placed under ui/ant/)
 *   game-art-*.json   → 'art'  (will be placed under game-art/, FLAT — D24)
 *   spec-*.md         → 'spec'
 *   everything else   → 'system'  (be-system-*, fe-system-*, api-contract-*)
 */
export function designSubdirOf(filename: string): DesignSubdir {
  if (filename.startsWith('game-art-') && filename.endsWith('.json')) return 'art';
  if (filename.startsWith('ui-') && filename.endsWith('.json')) return 'ui';
  if (filename.startsWith('spec-') && filename.endsWith('.md')) return 'spec';
  return 'system';
}

/**
 * Build the design output directory path for a given filename.
 * Returns e.g. 'outputs/design/system' or 'outputs/design/ui/ant' (ui-*.json
 * files live under the ant canonical source) or 'outputs/design/game-art'
 * (game-art-*.json files live FLAT — no sub-source — D24).
 */
export function designDirOf(filename: string): string {
  const sub = designSubdirOf(filename);
  if (sub === 'ui') return `${DESIGN_DIR}/ui/ant`;
  if (sub === 'art') return `${DESIGN_DIR}/game-art`;
  return `${DESIGN_DIR}/${sub}`;
}

// ============================================
// UiSource — three exclusive kinds of UI design input
// ============================================

/**
 * A `UiSource` is the abstract category of UI design input a code/design job
 * consumes. Exactly one source is chosen per job:
 *   - 'ant'     — canonical ant artifacts (ui-tokens/assets/spec.json)
 *   - 'figma'   — figma workfile reference (figma.json + live MCP exploration)
 *   - 'handoff' — free-form handoff file bundle (html/css/md/json/png...)
 *
 * `hasUi()` on `ArtifactPoolView` answers "is ANY UiSource present" — the
 * per-source interpretation is dispatched from prompts based on `uiSource`.
 */
export const UI_SOURCES = ['ant', 'figma', 'handoff'] as const;
export type UiSource = typeof UI_SOURCES[number];

// ============================================
// Artifact path prefixes (for ArtifactPoolView matching)
// ============================================

export const ARTIFACT_PREFIX = {
  SYSTEM_DESIGN: `${DESIGN_DIR}/system/` as const,
  SPEC: `${DESIGN_DIR}/spec/` as const,
  /**
   * Parent UI directory — union of all three UiSource subdirectories below.
   * `isUiArtifactPath()` should not match on this alone; it must match on one
   * of UI_ANT / UI_FIGMA / UI_HANDOFF.
   */
  UI: `${DESIGN_DIR}/ui/` as const,
  UI_ANT: `${DESIGN_DIR}/ui/ant/` as const,
  UI_FIGMA: `${DESIGN_DIR}/ui/figma/` as const,
  UI_HANDOFF: `${DESIGN_DIR}/ui/handoff/` as const,
  /**
   * Virtual prefix for ui-spec.json sections: `${UI_ANT_SPEC}header` etc.
   * The on-disk file is `outputs/design/ui/ant/ui-spec.json` (single file); the
   * pool exposes each parsed section under this synthetic path so task
   * artifactPolicy can reference specific sections.
   */
  UI_ANT_SPEC: `${DESIGN_DIR}/ui/ant/spec/` as const,
  /**
   * Phase 2 (D24): game-art surface — FLAT canonical, no sub-source.
   * The path itself is the directory; figma/handoff sub-sources for game-art
   * are deferred to Phase 5+ (visual job).
   */
  GAME_ART: `${DESIGN_DIR}/game-art/` as const,
  /**
   * Virtual prefix for game-art-spec.json category-keyed sections (D25).
   * Categories (effects/characters/projectiles/npcs/objectives/...) are
   * dynamically chosen by the LLM based on the game context — schema does
   * NOT enforce a fixed enum.
   */
  GAME_ART_SPEC: `${DESIGN_DIR}/game-art/spec/` as const,
  DESIGN: `${DESIGN_DIR}/` as const,
  SOURCES: 'inputs/sources' as const,
  API_CONTRACT: `${DESIGN_DIR}/system/api-contract-` as const,
  FE_SYSTEM: `${DESIGN_DIR}/system/fe-system-` as const,
  BE_SYSTEM: `${DESIGN_DIR}/system/be-system-` as const,
  ASSETS_SERVICE: 'inputs/assets/service/' as const,
  ASSETS_GAME: 'inputs/assets/game/' as const,
} as const;

/**
 * Classify a path into its `UiSource`. Returns null if the path is not under
 * the UI tree. Paths under `outputs/design/ui/ant/spec/...` map to 'ant' too
 * (the UI_ANT_SPEC virtual prefix is a subset of UI_ANT).
 */
export function uiSourceOfPath(path: string): UiSource | null {
  if (path.startsWith(ARTIFACT_PREFIX.UI_ANT)) return 'ant';
  if (path.startsWith(ARTIFACT_PREFIX.UI_FIGMA)) return 'figma';
  if (path.startsWith(ARTIFACT_PREFIX.UI_HANDOFF)) return 'handoff';
  return null;
}

/**
 * Whether any path in the list is a UI design document (ant / figma / handoff).
 *
 * Used by FE surfaces (BasisWizard, BasisSummaryBar) to compute the `hasUiDoc`
 * axis of `isTierActive('visualTier', ...)` from `actionMetadata.refs` /
 * `actionMetadata.context` — i.e. the user-selected RAC slots, NOT the raw
 * workspace filesystem. BE surfaces compute the same signal through
 * `ArtifactPoolView.hasUi()` over the post-RAC pool; both paths observe
 * "did the user decide to include a UI doc".
 */
export function pathsContainUiDoc(paths: readonly string[] | undefined): boolean {
  if (!paths?.length) return false;
  return paths.some(p => uiSourceOfPath(p) !== null);
}

/**
 * Whether any path in the list is a game-art design document (Phase 2 — D24).
 * D24 — game-art is FLAT: any path under `outputs/design/game-art/` qualifies.
 */
export function pathsContainGameArtDoc(paths: readonly string[] | undefined): boolean {
  if (!paths?.length) return false;
  return paths.some(p => p.startsWith(ARTIFACT_PREFIX.GAME_ART));
}

/**
 * Whether any path in the list is a design document (UI or game-art).
 * Convenience helper — union of `pathsContainUiDoc` + `pathsContainGameArtDoc`.
 */
export function pathsContainDesignDoc(paths: readonly string[] | undefined): boolean {
  return pathsContainUiDoc(paths) || pathsContainGameArtDoc(paths);
}

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

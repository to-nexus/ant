/**
 * Canonical Feature Structure Definitions (Single Source of Truth)
 *
 * Every canonical directory and file is defined ONCE here with a visibility tag.
 * All derived constants (full path lists, UI-visible subsets, lookup sets)
 * are computed from these arrays — no manual sync needed.
 *
 * 1차 분류 축은 도메인 의미(`plan` / `architecture` / `visual` / `assets` /
 * `meta` / `sessions` / `codebase`).
 *
 * Visibility tags:
 *   'ui:plan'         — `plan/` (PRD / GDD)
 *   'ui:architecture' — `architecture/` (system / spec)
 *   'ui:visual'       — `visual/` (ui / game-art sub-sources)
 *   'ui:assets'       — `assets/` (service / game / gen pools)
 *   'ui:meta'         — `meta/` (directives / evals)
 *   'internal'        — system-only, hidden from artifact UI
 */

type Visibility =
  | 'ui:plan'
  | 'ui:architecture'
  | 'ui:visual'
  | 'ui:assets'
  | 'ui:meta'
  | 'internal';

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
  // plan — depth -1 (sources 폴더 제거, 파일 직속). plan/ 자체가 sources 의미.
  { path: 'plan',                              visibility: 'ui:plan' },

  // architecture — system / spec 두 트랙
  { path: 'architecture',                      visibility: 'ui:architecture' },
  { path: 'architecture/system',               visibility: 'internal' },
  { path: 'architecture/spec',                 visibility: 'internal' },

  // visual — ui / game-art (sub-sourced; D24-revised v8)
  { path: 'visual',                            visibility: 'ui:visual' },
  { path: 'visual/ui',                         visibility: 'internal' },
  { path: 'visual/ui/ant',                     visibility: 'internal' },
  { path: 'visual/ui/figma',                   visibility: 'internal' },
  { path: 'visual/ui/handoff',                 visibility: 'internal' },
  { path: 'visual/game-art',                   visibility: 'internal' },
  { path: 'visual/game-art/ant',               visibility: 'internal' },
  { path: 'visual/game-art/figma',             visibility: 'internal' },
  { path: 'visual/game-art/handoff',           visibility: 'internal' },

  // assets (parent UI-visible; per-domain pools internal — workspace.domain decides)
  { path: 'assets',                            visibility: 'ui:assets' },
  { path: 'assets/service',                    visibility: 'internal' },
  { path: 'assets/service/icons',              visibility: 'internal' },
  { path: 'assets/service/images',             visibility: 'internal' },
  { path: 'assets/service/fonts',              visibility: 'internal' },
  { path: 'assets/service/misc',               visibility: 'internal' },
  { path: 'assets/game',                       visibility: 'internal' },
  { path: 'assets/game/icons',                 visibility: 'internal' },
  { path: 'assets/game/images',                visibility: 'internal' },
  { path: 'assets/game/entities',              visibility: 'internal' },
  { path: 'assets/game/particles',             visibility: 'internal' },
  { path: 'assets/game/projectiles',           visibility: 'internal' },
  { path: 'assets/game/sfx',                   visibility: 'internal' },
  { path: 'assets/game/bgm',                   visibility: 'internal' },
  { path: 'assets/game/tilemaps',              visibility: 'internal' },
  { path: 'assets/game/atlas',                 visibility: 'internal' },
  { path: 'assets/game/models',                visibility: 'internal' },
  { path: 'assets/gen',                        visibility: 'internal' },
  { path: 'assets/gen/sketches',               visibility: 'internal' },

  // meta — 잡 메타 트랙 컨테이너 (directives / evals)
  { path: 'meta',                              visibility: 'ui:meta' },
  { path: 'meta/directives',                   visibility: 'internal' },
  { path: 'meta/directives/design',            visibility: 'internal' },
  { path: 'meta/directives/code',              visibility: 'internal' },
  { path: 'meta/directives/plan',              visibility: 'internal' },
  { path: 'meta/directives/visual',            visibility: 'internal' },
  { path: 'meta/directives/learn',             visibility: 'internal' },
  { path: 'meta/evals',                        visibility: 'internal' },
  { path: 'meta/evals/prd',                    visibility: 'internal' },
  { path: 'meta/evals/ui-design',              visibility: 'internal' },
  { path: 'meta/evals/system-design',          visibility: 'internal' },
  { path: 'meta/evals/code',                   visibility: 'internal' },

  // sessions (unchanged)
  { path: 'sessions',                          visibility: 'internal' },
  { path: 'sessions/architect',                visibility: 'internal' },
  { path: 'sessions/architect/debug',          visibility: 'internal' },
  { path: 'sessions/architect/debug/prompts',  visibility: 'internal' },
  { path: 'sessions/architect/debug/plans',    visibility: 'internal' },
  { path: 'sessions/architect/debug/logs',     visibility: 'internal' },
  { path: 'sessions/architect/debug/tokens',   visibility: 'internal' },
  { path: 'sessions/architect/debug/figma',    visibility: 'internal' },
  { path: 'sessions/architect/runtime',        visibility: 'internal' },
  { path: 'sessions/architect/runtime/design', visibility: 'internal' },
  { path: 'sessions/architect/runtime/code',   visibility: 'internal' },
  { path: 'sessions/planner',                  visibility: 'internal' },
  { path: 'sessions/planner/debug',            visibility: 'internal' },
  { path: 'sessions/planner/debug/prompts',    visibility: 'internal' },
  { path: 'sessions/creator',                  visibility: 'internal' },
  { path: 'sessions/creator/debug',            visibility: 'internal' },
  { path: 'sessions/creator/debug/prompts',    visibility: 'internal' },
];

// ============================================
// File definitions
// ============================================

const CANONICAL_FILE_DEFS: ReadonlyArray<CanonicalFileDef> = [
  { path: 'visual/ui/figma/figma.json', visibility: 'internal' },
];

/**
 * Canonical path for the figma workfile reference (URL + fileKey + nodeId metadata).
 * This file holds ONLY the reference to the Figma workfile; it never stores
 * any exploration output. design job consumes it to produce ant-ui artifacts
 * at `visual/ui/ant/`, and code job consumes it at runtime via MCP.
 */
export const FIGMA_CONFIG_PATH = 'visual/ui/figma/figma.json' as const;

// ============================================
// Derived: full canonical path lists
// ============================================

export const CANONICAL_FEATURE_DIRS: ReadonlyArray<string> =
  CANONICAL_DIR_DEFS.map(d => d.path);

/** Canonical file relative paths — content factories are defined in sessionPaths.ts (backend-only) */
export const CANONICAL_FEATURE_FILE_PATHS: ReadonlyArray<string> =
  CANONICAL_FILE_DEFS.map(f => f.path);

// ============================================
// Derived: UI-visible top-level dirs (ArtifactsPanel)
// ============================================

/**
 * Top-level dirs shown in ArtifactsPanel, keyed by visibility tag.
 *
 * 도메인 1차 분류 축으로 재구성된 후, 1단계 dir 자체가 visibility 단위이므로
 * I/O 분기 없이 단일 export 로 통합한다. ArtifactsPanel 측이 visibility 태그로
 * 그룹핑하여 표시한다.
 */
export const UI_VISIBLE_TOP_LEVEL_DIRS: ReadonlyArray<{ name: string; visibility: Visibility }> =
  CANONICAL_DIR_DEFS
    .filter(d => d.visibility.startsWith('ui:'))
    .filter(d => !d.path.includes('/'))
    .map(d => ({ name: d.path, visibility: d.visibility }));

/**
 * Top-level file names shown in ArtifactsPanel.
 *
 * `CANONICAL_FILE_DEFS` 의 모든 `ui:*` visibility 항목을 일반화하여 포함한다.
 */
export const UI_VISIBLE_FILES: ReadonlyArray<string> =
  CANONICAL_FILE_DEFS
    .filter(f => f.visibility.startsWith('ui:'))
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

export type DesignSubdir = 'ui' | 'gameArt' | 'system' | 'spec';

export const DESIGN_SUBDIR = {
  UI: 'ui',
  GAME_ART: 'gameArt',
  SYSTEM: 'system',
  SPEC: 'spec',
} as const satisfies Record<string, DesignSubdir>;

export const DESIGN_SUBDIRS: ReadonlyArray<DesignSubdir> = Object.values(DESIGN_SUBDIR);

/**
 * Determine which design subdirectory a file belongs to based on filename.
 *   ui-*.json         → 'ui'      (will be placed under visual/ui/ant/)
 *   game-art-*.json   → 'gameArt' (will be placed under visual/game-art/ant/ — D24-revised v8)
 *   spec-*.md         → 'spec'
 *   everything else   → 'system'  (be-system-*, fe-system-*, api-contract-*)
 */
export function designSubdirOf(filename: string): DesignSubdir {
  if (filename.startsWith('game-art-') && filename.endsWith('.json')) return 'gameArt';
  if (filename.startsWith('ui-') && filename.endsWith('.json')) return 'ui';
  if (filename.startsWith('spec-') && filename.endsWith('.md')) return 'spec';
  return 'system';
}

/**
 * Build the design output directory path for a given filename.
 * Returns e.g. `architecture/system` or `visual/ui/ant` (ui-*.json files
 * live under the ant canonical source) or `visual/game-art/ant`
 * (game-art-*.json files live under the ant canonical source — D24-revised v8;
 * mirrors the ui/ant pattern) or `architecture/spec` (spec-*.md).
 */
export function designDirOf(filename: string): string {
  const sub = designSubdirOf(filename);
  if (sub === 'ui') return 'visual/ui/ant';
  if (sub === 'gameArt') return 'visual/game-art/ant';
  if (sub === 'spec') return 'architecture/spec';
  return 'architecture/system';
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
  SYSTEM_DESIGN: 'architecture/system/' as const,
  SPEC: 'architecture/spec/' as const,
  /**
   * Parent UI directory — union of all three UiSource subdirectories below.
   * `isUiArtifactPath()` should not match on this alone; it must match on one
   * of UI_ANT / UI_FIGMA / UI_HANDOFF.
   */
  UI: 'visual/ui/' as const,
  UI_ANT: 'visual/ui/ant/' as const,
  UI_FIGMA: 'visual/ui/figma/' as const,
  UI_HANDOFF: 'visual/ui/handoff/' as const,
  /**
   * Virtual prefix for ui-spec.json sections: `${UI_ANT_SPEC}header` etc.
   * The on-disk file is `visual/ui/ant/ui-spec.json` (single file); the pool
   * exposes each parsed section under this synthetic path so task
   * artifactPolicy can reference specific sections.
   */
  UI_ANT_SPEC: 'visual/ui/ant/spec/' as const,
  /**
   * v8 (D24-revised): game-art surface — sub-sourced (mirrors ui/).
   *   - GAME_ART       — parent prefix (union of ant/figma/handoff).
   *   - GAME_ART_ANT   — LLM-generated canonical sub-source (active today).
   *   - GAME_ART_FIGMA — figma workfile reference (Phase 5+ hook, parser-only).
   *   - GAME_ART_HANDOFF — free-form handoff bundle (Phase 5+ hook, parser-only).
   *
   * `pathsContainGameArtDoc` matches any of the three sub-source prefixes
   * (mirrors the UI sub-source pattern). The flat `GAME_ART` prefix stays
   * for parent-level operations (filetree, mount), but new game-art
   * artifacts MUST land under `GAME_ART_ANT`.
   */
  GAME_ART: 'visual/game-art/' as const,
  GAME_ART_ANT: 'visual/game-art/ant/' as const,
  GAME_ART_FIGMA: 'visual/game-art/figma/' as const,
  GAME_ART_HANDOFF: 'visual/game-art/handoff/' as const,
  /**
   * Virtual prefix for game-art-spec.json category-keyed sections (D25).
   * Categories (effects/characters/projectiles/npcs/objectives/...) are
   * dynamically chosen by the LLM based on the game context — schema does
   * NOT enforce a fixed enum.
   */
  GAME_ART_SPEC: 'visual/game-art/ant/spec/' as const,
  SOURCES: 'plan' as const,
  API_CONTRACT: 'architecture/system/api-contract-' as const,
  FE_SYSTEM: 'architecture/system/fe-system-' as const,
  BE_SYSTEM: 'architecture/system/be-system-' as const,
  ASSETS_SERVICE: 'assets/service/' as const,
  ASSETS_GAME: 'assets/game/' as const,
} as const;

/**
 * Classify a path into its `UiSource`. Returns null if the path is not under
 * the UI tree. Paths under `visual/ui/ant/spec/...` map to 'ant' too
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
 * Classify a path into its game-art sub-source. Returns null if the path is
 * not under the game-art tree. Mirrors `uiSourceOfPath` shape (D24-revised).
 *
 * v8 (D24-revised): only `'ant'` is canonical today; `'figma'` / `'handoff'`
 * remain hooks for Phase 5+ (visual job).
 */
export function gameArtSourceOfPath(path: string): UiSource | null {
  if (path.startsWith(ARTIFACT_PREFIX.GAME_ART_ANT)) return 'ant';
  if (path.startsWith(ARTIFACT_PREFIX.GAME_ART_FIGMA)) return 'figma';
  if (path.startsWith(ARTIFACT_PREFIX.GAME_ART_HANDOFF)) return 'handoff';
  return null;
}

/**
 * Whether any path in the list is a game-art design document (D24-revised v8).
 * Matches any of the three sub-source prefixes (`ant/` is active today;
 * `figma/` / `handoff/` are Phase 5+ hooks).
 *
 * 단방향 원칙: 비-canonical path 에 대한 BC 분기는 두지 않는다. 디스크
 * 정합성은 워크스페이스 부트 가드가 책임진다.
 */
export function pathsContainGameArtDoc(paths: readonly string[] | undefined): boolean {
  if (!paths?.length) return false;
  return paths.some(p =>
    p.startsWith(ARTIFACT_PREFIX.GAME_ART_ANT) ||
    p.startsWith(ARTIFACT_PREFIX.GAME_ART_FIGMA) ||
    p.startsWith(ARTIFACT_PREFIX.GAME_ART_HANDOFF)
  );
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

import type { Domain } from './detection';
import type { FileNode } from './file-resource';

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
 *   'ui:plan'         — `plan/` (PRD)
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

/**
 * Per-section mutation permissions for a top-level domain row in the
 * ArtifactsPanel SSOT loop (`UI_PANEL_TOP_LEVEL_DIRS`). Undefined fields
 * mean "allowed by default" — the SSOT loop in `ArtifactsPanel.tsx`
 * threads each handler unconditionally unless `permissions?.<op>` is
 * explicitly `false`, which collapses the prop to `undefined` and hides
 * the corresponding affordance.
 *
 * Today this gates the sessions row (`create/upload/rename/send: false`,
 * `delete/download: true`). New domains that need analogous gating can
 * attach `permissions` to their `CanonicalDirDef` entry rather than
 * re-introducing a hand-written second <ArtifactsSection> invocation.
 */
export interface ArtifactPermissions {
  readonly create?: boolean;
  readonly upload?: boolean;
  readonly rename?: boolean;
  readonly send?: boolean;
  readonly delete?: boolean;
  readonly download?: boolean;
}

interface CanonicalDirDef {
  readonly path: string;
  readonly visibility: Visibility;
  readonly permissions?: ArtifactPermissions;
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

  // sessions — surfaced in ArtifactsPanel via UI_PANEL_TOP_LEVEL_DIRS with
  // restricted permissions (delete + download only). Stays `internal` so
  // artifact-only surfaces (e.g. Transfer/SendSubTab via
  // UI_VISIBLE_TOP_LEVEL_DIRS) remain sessions-free.
  {
    path: 'sessions',
    visibility: 'internal',
    permissions: {
      create: false,
      upload: false,
      rename: false,
      send: false,
      delete: true,
      download: true,
    },
  },
  { path: 'sessions/architect',                visibility: 'internal' },
  { path: 'sessions/architect/debug',          visibility: 'internal' },
  { path: 'sessions/architect/debug/prompts',  visibility: 'internal' },
  { path: 'sessions/architect/debug/plans',    visibility: 'internal' },
  { path: 'sessions/architect/debug/analysis', visibility: 'internal' },
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
  { path: 'visual/game-art/figma/figma.json', visibility: 'internal' },
];

/**
 * Canonical path for the figma workfile reference (URL + fileKey + nodeId metadata).
 * This file holds ONLY the reference to the Figma workfile; it never stores
 * any exploration output. design job consumes it to produce ant-ui artifacts
 * at `visual/ui/ant/`, and code job consumes it at runtime via MCP.
 *
 * Service-domain path. Domain-agnostic callers MUST use
 * {@link figmaConfigPathFor} / {@link FIGMA_CONFIG_PATHS} instead — D28's
 * vertical split forbids a game workspace from reaching into `visual/ui/**`.
 */
export const FIGMA_CONFIG_PATH = 'visual/ui/figma/figma.json' as const;

/** Game-domain peer of {@link FIGMA_CONFIG_PATH} (I10 sub-source symmetry). */
export const GAME_ART_FIGMA_CONFIG_PATH = 'visual/game-art/figma/figma.json' as const;

/**
 * Figma workfile reference path for a workspace domain. The figma sub-source
 * must live under its own surface tree so `uiSourceOfPath` /
 * `gameArtSourceOfPath` can classify the ref — a single shared location would
 * make a game-art figma ref unclassifiable and silently degrade the revise
 * pipeline to the ant `by-desc` variant.
 */
export function figmaConfigPathFor(domain: Domain | undefined | null): string {
  return domain === 'game' ? GAME_ART_FIGMA_CONFIG_PATH : FIGMA_CONFIG_PATH;
}

/**
 * Every figma workfile reference location. For domain-agnostic presence scans
 * (e.g. `WorkspaceState.hasFigmaConfig`) — at most one surface can carry a
 * *populated* workfile per workspace, so an OR over this list needs no domain
 * input. Note that both paths always EXIST on disk: `ensureCanonicalStructure`
 * scaffolds a `{"file": null}` placeholder into each surface regardless of
 * domain, so any presence scan over this list must test populated content
 * (`isFigmaDataPopulated`) rather than file or directory existence.
 */
export const FIGMA_CONFIG_PATHS: ReadonlyArray<string> = [
  FIGMA_CONFIG_PATH,
  GAME_ART_FIGMA_CONFIG_PATH,
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
 * Top-level dirs shown in **ArtifactsPanel only** (SSOT for that surface).
 *
 * Differs from {@link UI_VISIBLE_TOP_LEVEL_DIRS} by including the
 * `sessions` row alongside the `ui:*` domains, gated by per-row
 * {@link ArtifactPermissions}. The order preserves `CANONICAL_DIR_DEFS`
 * source order, so `sessions` lands at the bottom of the panel.
 *
 * Do NOT use this list for transfer / artifact-only surfaces — those
 * MUST stay sessions-free and consume `UI_VISIBLE_TOP_LEVEL_DIRS`
 * (see `Transfer/SendSubTab.tsx`'s `ALLOWED_TOP_LEVEL`).
 */
export const UI_PANEL_TOP_LEVEL_DIRS: ReadonlyArray<{
  name: string;
  visibility: Visibility;
  permissions?: ArtifactPermissions;
}> =
  CANONICAL_DIR_DEFS
    .filter(d => !d.path.includes('/'))
    .filter(d => d.visibility.startsWith('ui:') || d.path === 'sessions')
    .map(d => ({ name: d.path, visibility: d.visibility, permissions: d.permissions }));

/**
 * Top-level file names shown in ArtifactsPanel.
 *
 * `CANONICAL_FILE_DEFS` 의 모든 `ui:*` visibility 항목을 일반화하여 포함한다.
 */
export const UI_VISIBLE_FILES: ReadonlyArray<string> =
  CANONICAL_FILE_DEFS
    .filter(f => f.visibility.startsWith('ui:'))
    .map(f => f.path.split('/').pop()!);

const FEATURE_TREE_ROOT_ENTRIES = new Set<string>([
  ...UI_PANEL_TOP_LEVEL_DIRS.map(d => d.name),
  ...UI_VISIBLE_FILES,
]);

/**
 * Whether a feature-root entry name belongs in the feature file tree.
 *
 * The membership rule for "what is an artifact" used to live in three places
 * with two different polarities: two backend walks excluded a fixed blacklist
 * (`node_modules`/`dist`/`codebase`/…) while ArtifactsPanel rendered only
 * {@link UI_PANEL_TOP_LEVEL_DIRS}. A blacklist is open, so every new
 * feature-root directory leaked into the payload and was then discarded by the
 * panel — `deploy/` (the rsync snapshot of `codebase/`) alone accounted for 78%
 * of the tree nodes on a measured feature.
 *
 * Applies to the feature root ONLY. Inside a canonical directory the tree stays
 * open — that is where user uploads land.
 *
 * `codebase/` needs no special case here: it is not a canonical dir, so the
 * allowlist excludes it (it is browsed via the IDE, not the Explorer).
 */
export function isFeatureTreeRootEntry(name: string): boolean {
  return FEATURE_TREE_ROOT_ENTRIES.has(name);
}

/**
 * Returns a shallow-cloned file tree with `visual/` and `assets/` immediate
 * directory children narrowed to the workspace {@link Domain} (D28 — service:
 * `visual/ui` + `assets/service`; game: `visual/game-art` + `assets/game`).
 * `assets/gen` and other non-pool siblings stay visible in both domains.
 */
export function pruneFileTreeForWorkspaceDomain(
  tree: FileNode[],
  domain: Domain | undefined | null,
): FileNode[] {
  const d: Domain = domain === 'game' || domain === 'service' ? domain : 'service';
  return tree.map(node => pruneFileTreeNodeForWorkspaceDomain(node, d));
}

function pruneFileTreeNodeForWorkspaceDomain(node: FileNode, domain: Domain): FileNode {
  if (!node.children?.length) return node;
  let nextChildren = node.children;
  if (node.path === 'visual') {
    nextChildren = nextChildren.filter(
      c => c.type !== 'directory' || (domain === 'service' ? c.name === 'ui' : c.name === 'game-art'),
    );
  } else if (node.path === 'assets') {
    nextChildren = nextChildren.filter(
      c =>
        c.type !== 'directory' ||
        c.name === 'gen' ||
        (c.name === 'service' && domain === 'service') ||
        (c.name === 'game' && domain === 'game') ||
        (c.name !== 'service' && c.name !== 'game'),
    );
  }
  return {
    ...node,
    children: nextChildren.map(c => pruneFileTreeNodeForWorkspaceDomain(c, domain)),
  };
}

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
   *   - GAME_ART_HANDOFF — free-form handoff bundle (active — WS2 §3: RAC
   *                        subgroup slot + pool stub-load + code dispatch,
   *                        symmetric with UI handoff).
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
  /**
   * Visual-job output pool. Not domain-scoped (there is one gen surface), so
   * `pickAssetsRoot` never returns it — but it is a real pool of real files and
   * every "can the job reach an asset pool" predicate must include it.
   */
  ASSETS_GEN: 'assets/gen/' as const,
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

// ============================================
// UiSource hard-exclusive SSOT (domain rule funnel)
// ============================================

/**
 * Hard-exclusive UiSource priority order — `ant` wins over `figma` wins over
 * `handoff`. This order encodes the domain rule "the project's authored
 * canonical (ant) is the preferred input; figma is the bridged authority;
 * handoff is the free-form fallback."
 *
 * `UI_SOURCE_SUBGROUPS` (action-config-matrix.ts) MUST register subgroups in
 * this exact order; the symmetry test `tests/uiSourceExclusivity.test.ts`
 * locks the relationship.
 */
export const UI_SOURCE_PRIORITY: readonly UiSource[] = ['ant', 'figma', 'handoff'];

// ── Generic source funnel (single-owner) ──────────────────────────────
// The UI and game-art surfaces share identical funnel logic; the only
// per-surface difference is the path classifier (`uiSourceOfPath` vs
// `gameArtSourceOfPath`) and the tree-parent prefix. These generics own the
// logic once — the UI and game-art exports below are thin instances (WS2 §3A).
// `UiSource` is the shared source enum for BOTH surfaces (ant/figma/handoff).

type SourceClassifier = (path: string) => UiSource | null;

/**
 * `preferred` outranks the static priority for one call. It exists because a
 * MERGE combines lists of different authority: a source the user explicitly
 * selected must not lose to one inference guessed at (an attached `handoff`
 * screenshot losing to an inferred `ant` doc). Absent, or absent from `paths`
 * → the static priority decides, so every existing caller is unchanged.
 */
function pickSourceWith(
  paths: readonly string[] | undefined,
  sourceOf: SourceClassifier,
  priority: readonly UiSource[],
  preferred?: UiSource | null,
): UiSource | null {
  if (!paths?.length) return null;
  const present = new Set<UiSource>();
  for (const p of paths) {
    const src = sourceOf(p);
    if (src !== null) present.add(src);
  }
  if (present.size === 0) return null;
  if (preferred && present.has(preferred)) return preferred;
  for (const id of priority) {
    if (present.has(id)) return id;
  }
  return null;
}

/**
 * Apply an ALREADY-DECIDED verdict to a path list: unclassified paths pass, the
 * winning source passes, every other source is dropped.
 *
 * Separate from {@link normalizeSourceRefsWith} because a caller holding several
 * slots needs ONE verdict across all of them. Deciding per slot is only safe when
 * the decision is a global static order — the moment a caller-supplied preference
 * enters, per-slot decisions diverge (`refs` containing only `ant` keeps `ant`
 * while `context` resolves to `handoff`) and the RAC comes out mixed, which is
 * precisely what the hard-exclusive invariant forbids.
 */
function filterToSourceWith(
  paths: readonly string[] | undefined,
  sourceOf: SourceClassifier,
  winner: UiSource | null,
): string[] {
  if (!paths?.length) return [];
  if (winner === null) return [...paths];
  return paths.filter(p => {
    const src = sourceOf(p);
    return src === null || src === winner;
  });
}

function normalizeSourceRefsWith(
  paths: readonly string[] | undefined,
  sourceOf: SourceClassifier,
  priority: readonly UiSource[],
): string[] {
  if (!paths?.length) return [];
  return filterToSourceWith(paths, sourceOf, pickSourceWith(paths, sourceOf, priority));
}

function pickDefaultSourceRefsWith<F>(
  subgroups: readonly { id: UiSource; hasValidFiles: boolean; files: readonly F[] }[] | undefined,
  priority: readonly UiSource[],
): F[] {
  if (!subgroups?.length) return [];
  for (const id of priority) {
    const sg = subgroups.find(s => s.id === id && s.hasValidFiles);
    if (sg) return [...sg.files];
  }
  return [];
}

function pickSourceSubgroupDirWith(
  subgroups: readonly { id: UiSource; dir: string; hasValidFiles: boolean }[] | undefined,
  priority: readonly UiSource[],
): string | null {
  if (!subgroups?.length) return null;
  for (const id of priority) {
    const sg = subgroups.find(s => s.id === id && s.hasValidFiles);
    if (sg) return sg.dir;
  }
  return null;
}

function isTreeParentPathWith(p: string, treePrefix: string, sourceOf: SourceClassifier): boolean {
  const inTree = p === treePrefix.replace(/\/$/, '') || p.startsWith(treePrefix);
  return inTree && sourceOf(p) === null;
}

// ── UI instances (thin wrappers over the generic funnel) ──────────────

/**
 * Pick the single UiSource a path list should be normalized to. Returns the
 * highest-priority source present, or `null` if no UI paths are involved.
 */
export function pickUiSource(
  paths: readonly string[] | undefined,
  preferredSource?: UiSource | null,
): UiSource | null {
  return pickSourceWith(paths, uiSourceOfPath, UI_SOURCE_PRIORITY, preferredSource);
}

/**
 * Apply a decided UiSource verdict to one slot's paths. Pair with
 * {@link pickUiSource} over the UNION of every slot when more than one slot is
 * being normalized against a caller-supplied preference — see
 * `filterToSourceWith` for why the verdict cannot be taken per slot.
 */
export function filterToUiSource(
  paths: readonly string[] | undefined,
  winner: UiSource | null,
): string[] {
  return filterToSourceWith(paths, uiSourceOfPath, winner);
}

/**
 * Enforce the hard-exclusive UiSource invariant on a path list. **SSOT for
 * "exactly one UiSource"** — every funnel that produces or merges path lists
 * destined for a RAC MUST route through here. `validateUiSourceExclusivity`
 * and `ArtifactPoolView.uiSource()` are downstream safety nets. Order-preserving.
 */
export function normalizeUiSourceRefs(paths: readonly string[] | undefined): string[] {
  return normalizeSourceRefsWith(paths, uiSourceOfPath, UI_SOURCE_PRIORITY);
}

/**
 * Auto-fill picker for `type: 'ui-source'` slots — the highest-priority
 * subgroup with `hasValidFiles` (per `UI_SOURCE_PRIORITY`). Empty when none.
 */
export function pickDefaultUiSourceRefs<F>(
  subgroups: readonly { id: UiSource; hasValidFiles: boolean; files: readonly F[] }[] | undefined,
): F[] {
  return pickDefaultSourceRefsWith(subgroups, UI_SOURCE_PRIORITY);
}

/**
 * BE infer-path counterpart of `pickDefaultUiSourceRefs` — the single valid
 * UiSource subgroup *directory*. `null` means "no valid subgroup" and callers
 * MUST drop the slot (never fall back to the parent `visual/ui`, which is
 * unclassifiable and directory-walks across all three subgroups → mixed-pool throw).
 */
export function pickUiSourceSubgroupDir(
  subgroups: readonly { id: UiSource; dir: string; hasValidFiles: boolean }[] | undefined,
): string | null {
  return pickSourceSubgroupDirWith(subgroups, UI_SOURCE_PRIORITY);
}

/**
 * Whether a path is inside the UI tree but NOT under a specific UiSource
 * subgroup — the un-narrowed parent `visual/ui`. The infer path rewrites these
 * to a single subgroup directory before they reach the RAC.
 */
export function isUiTreeParentPath(p: string): boolean {
  return isTreeParentPathWith(p, ARTIFACT_PREFIX.UI, uiSourceOfPath);
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
 * Matches any of the three sub-source prefixes (`ant/` + `handoff/` are active;
 * `figma/` is a Phase 5+ hook).
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

// ── game-art instances (thin wrappers over the generic funnel) ────────
// Symmetric with the UI instances above (WS2 §3A). game-art reuses the
// `UiSource` enum + `['ant','figma','handoff']` priority; the classifier is
// `gameArtSourceOfPath` and the tree prefix is `ARTIFACT_PREFIX.GAME_ART`.

/**
 * Hard-exclusive game-art source priority — mirrors `UI_SOURCE_PRIORITY`.
 * `GAME_ART_SOURCE_SUBGROUPS` (action-config-matrix.ts) MUST register subgroups
 * in this order; the symmetry test locks the relationship.
 */
export const GAME_ART_SOURCE_PRIORITY: readonly UiSource[] = ['ant', 'figma', 'handoff'];

/** Pick the single game-art source a path list should normalize to (ant > figma > handoff). */
export function pickGameArtSource(paths: readonly string[] | undefined): UiSource | null {
  return pickSourceWith(paths, gameArtSourceOfPath, GAME_ART_SOURCE_PRIORITY);
}

/** SSOT for "exactly one game-art source" on a path list. Mirrors `normalizeUiSourceRefs`. */
export function normalizeGameArtSourceRefs(paths: readonly string[] | undefined): string[] {
  return normalizeSourceRefsWith(paths, gameArtSourceOfPath, GAME_ART_SOURCE_PRIORITY);
}

/** FE auto-fill picker for a game-art `type: 'ui-source'` slot. Mirrors `pickDefaultUiSourceRefs`. */
export function pickDefaultGameArtSourceRefs<F>(
  subgroups: readonly { id: UiSource; hasValidFiles: boolean; files: readonly F[] }[] | undefined,
): F[] {
  return pickDefaultSourceRefsWith(subgroups, GAME_ART_SOURCE_PRIORITY);
}

/** BE infer-path picker for the single valid game-art subgroup directory. Mirrors `pickUiSourceSubgroupDir`. */
export function pickGameArtSourceSubgroupDir(
  subgroups: readonly { id: UiSource; dir: string; hasValidFiles: boolean }[] | undefined,
): string | null {
  return pickSourceSubgroupDirWith(subgroups, GAME_ART_SOURCE_PRIORITY);
}

/** Whether a path is the un-narrowed game-art parent `visual/game-art`. Mirrors `isUiTreeParentPath`. */
export function isGameArtTreeParentPath(p: string): boolean {
  return isTreeParentPathWith(p, ARTIFACT_PREFIX.GAME_ART, gameArtSourceOfPath);
}

/**
 * Whether any path in the list is a design document (UI or game-art).
 * Convenience helper — union of `pathsContainUiDoc` + `pathsContainGameArtDoc`.
 */
export function pathsContainDesignDoc(paths: readonly string[] | undefined): boolean {
  return pathsContainUiDoc(paths) || pathsContainGameArtDoc(paths);
}

// ============================================
// Handoff bundle-root SSOT
// ============================================

/** `visual/ui/handoff` — canonical bundle-root form (no trailing slash). */
const UI_HANDOFF_ROOT = ARTIFACT_PREFIX.UI_HANDOFF.replace(/\/$/, '');
/** `visual/game-art/handoff` — canonical bundle-root form (no trailing slash). */
const GAME_ART_HANDOFF_ROOT = ARTIFACT_PREFIX.GAME_ART_HANDOFF.replace(/\/$/, '');

/**
 * Handoff bundle-root SSOT — a handoff bundle is one indivisible selection
 * unit. Any path classified into the `handoff` sub-source (either surface)
 * is widened to its bundle root dir (`visual/ui/handoff` /
 * `visual/game-art/handoff`, no trailing slash — the same string the infer
 * path's `resolveUiSourceDir` emits), deduped order-preserving. Non-handoff
 * paths pass through unchanged. Idempotent: the bare root (with or without
 * trailing slash) maps to the canonical root string.
 *
 * Why: the by-handoff revise contract makes the on-disk bundle the layout
 * authority — decompose must observe the whole bundle (manifest stubs +
 * on-demand `read_file`). A file-granular RAC entry starves the pool
 * manifest to one row and makes the RAC read gate deny the rest of the
 * bundle (tough-lacing-fable RCA). Widening at the RAC funnel converges the
 * explicit path with the infer path's already-proven bundle-dir shape.
 */
/**
 * Whether a path is a handoff bundle ROOT (not a file inside one) — i.e. the
 * exact value {@link widenHandoffRefsToBundleDir} widens to. Lets renderers
 * pick folder vs file affordances without guessing from the basename.
 */
export function isHandoffBundleRoot(p: string): boolean {
  return p === UI_HANDOFF_ROOT || p === GAME_ART_HANDOFF_ROOT;
}

export function widenHandoffRefsToBundleDir(
  paths: readonly string[] | undefined,
): string[] | undefined {
  if (!paths?.length) return paths as string[] | undefined;
  const widened = paths.map(p => {
    if (p === UI_HANDOFF_ROOT || p.startsWith(ARTIFACT_PREFIX.UI_HANDOFF)) {
      return UI_HANDOFF_ROOT;
    }
    if (p === GAME_ART_HANDOFF_ROOT || p.startsWith(ARTIFACT_PREFIX.GAME_ART_HANDOFF)) {
      return GAME_ART_HANDOFF_ROOT;
    }
    return p;
  });
  return [...new Set(widened)];
}

// ============================================
// Asset pool root resolution (domain-scoped SSOT)
// ============================================

/**
 * Pure routing input for {@link pickAssetsRoot}.
 *
 * Decoupled from any graph state so the resolver is unit-testable and shared
 * by every asset surface (design tool handlers, code resolve, spec). The three
 * D22 signals mirror the workspace-domain > per-turn-RAC > intent-heuristic
 * precedence.
 */
export interface AssetsRootInput {
  /** Workspace-level domain (SSOT after `p2-ui-actions-art-group`). */
  workspaceDomain?: Domain;
  /** Per-turn explicit/inferred RAC override. */
  racDomain?: Domain;
  /** RAC intent group — `'design-game-art'` implies `game` by matrix gate. */
  intentGroup?: string;
}

/**
 * Domain → asset pool root SSOT. Both the design tool handlers
 * (`download_asset` / `list_assets`) and the code/spec jobs resolve the active
 * pool through THIS one function so `assets/service` ↔ `assets/game` can never
 * be mixed (Asset Surface Boundary I6 enforced by construction).
 *
 * Resolution order (most authoritative first):
 *   1. `workspaceDomain`  — workspace-level 1st-class slot.
 *   2. `racDomain`        — per-turn explicit/inferred override.
 *   3. `intentGroup === 'design-game-art'` heuristic → `game`.
 *   4. Default `'service'`.
 *
 * Returns a relative path string starting with `assets/`.
 */
export function pickAssetsRoot(input: AssetsRootInput): string {
  const { workspaceDomain, racDomain, intentGroup } = input;
  const effective: Domain =
    workspaceDomain
      ?? racDomain
      ?? (intentGroup === 'design-game-art' ? 'game' : 'service');
  return `assets/${effective}`;
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

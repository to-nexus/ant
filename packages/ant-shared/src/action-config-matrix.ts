/**
 * Action Config Matrix
 *
 * Defines intent → (refs, context, target) mapping.
 * Single source of truth consumed by both FE (ActionConfigView) and
 * BE (resolve node) to determine which files to show/load.
 *
 * Two independent axes per slot:
 *   - role (refs vs context): determines prompt injection weight
 *   - required: determines auto-selection and empty-slot warnings
 *
 * Selection policy:
 *   - required slots: all valid files auto-selected (capped by refsMaxSelection)
 *   - optional slots: nothing auto-selected, user opts in manually
 *   - locked slots: always selected, cannot deselect
 *
 * Empty-slot UI:
 *   - required + empty → amber warning + Create/Upload
 *   - optional + empty → gray quiet + Create/Upload
 *
 * Activation policy (2 layers):
 *
 * Design principles:
 *   - canBuild implies canStartChat (build reachable → chat reachable)
 *   - Build requires refs/codebase (primary). Context-only build is invalid.
 *   - Directive-only intents (no real refs) → buildDisabled
 *
 * Layer 1 — System rules (derived from slot structure):
 *   - Default: chat ref gate = build ref gate (chatNeedsRefs = buildNeedsRefs)
 *   - chat-only target → build always disabled
 *   - buildDisabled: true → build always disabled (directive-only, visual gen, revise)
 *   - revise target → chat and build both need target selected
 *   - real ref slots → chat and build both require refs (default)
 *
 * Layer 2 — Override flags (per-intent):
 *   - chatRequiresRefs: false → chat without refs (directive-capable: gen-plan, gen-ui-desc, gen-spec)
 *   - buildRequiresRefs: false → build without refs even when real ref slots exist
 *   - buildRequiresContext: true → context must be selected for build
 *   - buildDisabled: true → build always disabled regardless of selections
 *
 * Terminology:
 *   - explicit chat: Actions panel "Start via Chat" — gated by canStartChat
 *   - build: Actions panel "Build" — gated by canBuild
 *   - implicit chat: general chat without Actions panel — bypasses this policy
 *   - chat-only target: explain/ask intents producing chat responses, not file artifacts
 */

// ============================================
// Types
// ============================================

/**
 * Per-intent basis slot configuration (Phase 1 — handoff §4.1 SSOT).
 *
 * `tiers` is the static gate (D7 / D9): a tier appears in `tiers` ⇔ this
 * intent opts into that tier. Domain compatibility is handled separately
 * by `TIER_DOMAIN_MATRIX`; runtime suppression (e.g. backend-only stacks,
 * UI-doc-present) layers on top via `RUNTIME_SUPPRESSORS`. The single
 * public predicate is `isTierActive(tier, slot, domain, runtime)` — no
 * per-tier helpers exist.
 *
 * `defaults` is per-domain only (no global single-shape fallback). When
 * domain-specific seeds are needed, populate the matching `Domain` key.
 * The detect node funnels through `applyDomainDefaultsToBasis` to fill
 * unset fields; user-supplied basis fields always win.
 */
export interface BasisSlotConfig {
  /**
   * Active tier keys for this intent. Order-insensitive; the matrix
   * iterates in the canonical `TIER_KEYS` order. Phase 1: no entry ⇔
   * this slot does not opt into any basis tier. An empty array means
   * the intent declares basis presence but exposes zero configurable
   * tiers (rev-* intents — the document under review already encodes
   * every basis decision).
   */
  tiers?: ReadonlyArray<import('./tier-matrix').TierKey>;
  /**
   * Per-domain seed values. Phase 1: game projects seed
   * `stack='frontend'` + `gameEngine='phaser'`; service projects use the
   * `service` key (or fall through to FE detection if absent). The
   * shape mirrors the handoff doc §4.1 exactly.
   */
  defaults?: Partial<Record<import('./detection').Domain, {
    stack?: 'frontend' | 'backend' | 'fullstack';
    gameEngine?: import('./rac').GameEngine;
  }>>;
  /**
   * Stack lock — when set, `techTier.stack` is force-pinned to this value
   * for the intent regardless of domain seed or user input. The wizard
   * hides the Stack step and the BE detect helper
   * (`applyDomainDefaultsToBasis`) overrides any inherited / inferred
   * stack so the user cannot change it. Used by `gen-sys-fe`,
   * `gen-sys-be`, `gen-sys-full` whose intent identity *is* the stack
   * decision.
   */
  lockedStack?: import('./rac').Stack;
}

export interface ConfigSlots {
  refs: SlotDef[];
  context: SlotDef[];
  target: TargetDef;
  /** Basis preset selector visibility. When present, BasisWizard renders for the matching tiers. */
  basis?: BasisSlotConfig;
  /** Override chat ref gating. Default: same as build ref gate.
   *  false → chat without refs (directive-capable intent).
   *  true → chat needs refs even when build doesn't (rare). */
  chatRequiresRefs?: boolean;
  /** Build without ref selection. Default true (= build needs refs). Set false to opt out. */
  buildRequiresRefs?: boolean;
  /** Context must be selected for build (e.g. rev-plan needs background docs). */
  buildRequiresContext?: boolean;
  /** Build is always disabled. Intent requires user directive via chat. */
  buildDisabled?: boolean;
  /** Only one ref file can be selected at a time (e.g. rev-plan: pick one document to revise). */
  refsSingleSelect?: boolean;
}

/**
 * Subgroup descriptor used by `type: 'ui-source'` slots.
 * The three UiSource ids (ant / figma / handoff) map to concrete
 * subdirectories under `visual/ui/`. The slot is hard-exclusive:
 * exactly one subgroup may be selected at a time.
 */
export interface UiSourceSubgroup {
  id: import('./canonical').UiSource;
  dir: string;
  label: { en: string; ko: string };
  humanLabel?: { en: string; ko: string };
}

export interface SlotDef {
  path: string;
  label: { en: string; ko: string };
  /**
   * 'dir' = expand to list files inside
   * 'file' = single file entry
   * 'ui-source' = UiSource subgroup selector (ant / figma / handoff, hard-exclusive)
   */
  type: 'dir' | 'file' | 'ui-source';
  /**
   * Whether this slot's files must be present for the action to work properly.
   * - true: auto-selected when files exist; amber warning when empty
   * - false: not auto-selected; gray quiet when empty
   * Refs default to true, context is always false.
   */
  required: boolean;
  /** When true, user cannot deselect (revise: ref = target file) */
  locked?: boolean;
  /** Shown when slot resolves to zero files */
  emptyHint?: { en: string; ko: string };
  /** When true, files already selected as refs are excluded from this slot's listing */
  excludeSelectedRefs?: boolean;
  /** Intent to navigate to when "Create" button is clicked on an empty slot */
  createIntent?: string;
  /** Human-readable name for the empty slot (e.g. "기획서", "시스템 설계 문서") */
  humanLabel?: { en: string; ko: string };
  /** When true, this slot represents the project codebase rather than feature-relative files */
  codebase?: boolean;
  /**
   * Auto-included slot — UI marks it as readonly with an "auto" hint.
   * Used by `codebaseSlot('context', { auto: true })` injected dynamically
   * for plan/design intents in workspaces with an existing codebase
   * (Codebase Channel SSOT). Static matrix entries should never set this.
   */
  auto?: boolean;
  /** Filenames to exclude from this slot's file listing (e.g. ['prd.md'] to hide canonical output) */
  excludeFiles?: string[];
  /** Populated only for `type: 'ui-source'`: the three hard-exclusive UiSource subgroups. */
  uiSources?: UiSourceSubgroup[];
  /**
   * D28 — domain-restricted slots. When set, the slot is only included
   * when `workspaceConfig.domain` is in this list. `undefined` = always
   * included (domain-agnostic). Used by `gen-code-*` to dispatch
   * `ui-source` (service) vs `game-art-source` (game) refs/context per
   * workspace domain without exploding the intent count.
   */
  applicableDomains?: ReadonlyArray<import('./detection').Domain>;
}

export type TargetDef =
  | { kind: 'generate'; dir: string; outputs: OutputSpec[] }
  | { kind: 'revise' }
  | { kind: 'codebase'; outputs?: OutputSpec[] }
  | { kind: 'chat-only'; hint: { en: string; ko: string } };

export interface OutputSpec {
  prefix: string;
  ext: string;
  label: { en: string; ko: string };
  isPattern: boolean;
  warnIfExists?: boolean;
}

export function formatOutputSpec(os: OutputSpec): string {
  return os.isPattern ? `${os.prefix}*${os.ext}` : `${os.prefix}${os.ext}`;
}

/** @deprecated Use matchesOutputSpec */
export const formatExpectedFile = formatOutputSpec;
/** @deprecated Use OutputSpec */
export type ExpectedFile = OutputSpec;

// ============================================
// Helpers
// ============================================

const CHAT_HINT = { en: 'Provide instructions via chat', ko: '채팅에 직접 입력합니다' };
const EXPLAIN_TARGET_HINT = { en: 'Explained in chat', ko: '채팅창에서 설명합니다' };
const ASK_TARGET_HINT = { en: 'Answered in chat', ko: '채팅창에서 답변합니다' };

interface RefOpts {
  locked?: boolean;
  createIntent?: string;
  humanLabel?: { en: string; ko: string };
  excludeFiles?: string[];
  /** Override required (refs default to true) */
  required?: boolean;
}

function refDir(path: string, label: { en: string; ko: string }, opts?: RefOpts): SlotDef {
  return { path, label, type: 'dir', required: opts?.required ?? true, locked: opts?.locked, createIntent: opts?.createIntent, humanLabel: opts?.humanLabel, excludeFiles: opts?.excludeFiles };
}

function refFile(path: string, label: { en: string; ko: string }, opts?: RefOpts): SlotDef {
  return { path, label, type: 'file', required: opts?.required ?? true, locked: opts?.locked, createIntent: opts?.createIntent, humanLabel: opts?.humanLabel, excludeFiles: opts?.excludeFiles };
}

interface CtxOpts {
  excludeSelectedRefs?: boolean;
  createIntent?: string;
  humanLabel?: { en: string; ko: string };
  excludeFiles?: string[];
}

function ctxDir(path: string, label: { en: string; ko: string }, opts?: CtxOpts): SlotDef {
  return { path, label, type: 'dir', required: false, excludeSelectedRefs: opts?.excludeSelectedRefs, createIntent: opts?.createIntent, humanLabel: opts?.humanLabel, excludeFiles: opts?.excludeFiles };
}

// ── ui-source slot helpers (3 hard-exclusive UiSource subgroups) ─────────────

const UI_SOURCE_SUBGROUPS: UiSourceSubgroup[] = [
  {
    id: 'ant',
    dir: 'visual/ui/ant',
    label: { en: 'Ant Canonical', ko: 'Ant 설계 문서' },
    humanLabel: { en: 'Ant Canonical UI Documents (ui-tokens / ui-assets / ui-spec)', ko: 'Ant 설계 문서 (ui-tokens / ui-assets / ui-spec)' },
  },
  {
    id: 'figma',
    dir: 'visual/ui/figma',
    label: { en: 'Figma', ko: 'Figma' },
    humanLabel: { en: 'Figma Workfile Reference (figma.json, interpreted via MCP)', ko: 'Figma 작업 파일 참조 (figma.json, MCP 로 해석)' },
  },
  {
    id: 'handoff',
    dir: 'visual/ui/handoff',
    label: { en: 'Handoff', ko: '핸드오프' },
    humanLabel: { en: 'Handoff (CLAUDE DESIGN)', ko: '핸드오프 (CLAUDE DESIGN)' },
  },
];

// ── game-art-source subgroups (WS2 §3 — mirror of UI_SOURCE_SUBGROUPS) ────────
// Same three hard-exclusive sub-sources under `visual/game-art/`. `ant` is the
// LLM-authored canonical (active today); `figma` / `handoff` mirror the UI
// naming — `handoff` is now wired end-to-end (§3), `figma` remains a Phase 5+
// parser hook. Registration order MUST match GAME_ART_SOURCE_PRIORITY.
const GAME_ART_SOURCE_SUBGROUPS: UiSourceSubgroup[] = [
  {
    id: 'ant',
    dir: 'visual/game-art/ant',
    label: { en: 'Ant Canonical', ko: 'Ant 설계 문서' },
    humanLabel: { en: 'Ant Canonical Game-Art Documents (game-art-tokens / assets / spec)', ko: 'Ant 게임아트 문서 (game-art-tokens / assets / spec)' },
  },
  {
    id: 'figma',
    dir: 'visual/game-art/figma',
    label: { en: 'Figma', ko: 'Figma' },
    humanLabel: { en: 'Figma Workfile Reference (Phase 5+ hook)', ko: 'Figma 작업 파일 참조 (Phase 5+ 훅)' },
  },
  {
    id: 'handoff',
    dir: 'visual/game-art/handoff',
    label: { en: 'Handoff', ko: '핸드오프' },
    humanLabel: { en: 'Game-Art Handoff bundle (free-form assets)', ko: '게임아트 핸드오프 번들 (자유 형식 에셋)' },
  },
];

/**
 * UI source slot as refs (primary authoritative input).
 * D28 — gated to `service` domain. Game workspaces consume `game-art-source`
 * via `gameArtSourceRef` / `gameArtSourceCtx` instead.
 */
function uiSourceRef(opts?: { createIntent?: string; humanLabel?: { en: string; ko: string } }): SlotDef {
  return {
    path: 'visual/ui',
    label: L.uiDesign,
    type: 'ui-source',
    required: true,
    uiSources: UI_SOURCE_SUBGROUPS,
    createIntent: opts?.createIntent,
    humanLabel: opts?.humanLabel ?? HL.uiDesign,
    applicableDomains: ['service'],
  };
}

/**
 * UI source slot as context (supplementary background input).
 * D28 — service domain only.
 */
function uiSourceCtx(opts?: { createIntent?: string; humanLabel?: { en: string; ko: string } }): SlotDef {
  return {
    path: 'visual/ui',
    label: L.uiDesign,
    type: 'ui-source',
    required: false,
    uiSources: UI_SOURCE_SUBGROUPS,
    createIntent: opts?.createIntent,
    humanLabel: opts?.humanLabel ?? HL.uiDesign,
    applicableDomains: ['service'],
  };
}

/**
 * Game-art source slot as refs (primary authoritative input).
 * WS2 §3 — subgroup dispatcher (`ant` / `figma` / `handoff`), mirroring
 * `uiSourceRef`. The parent dir `visual/game-art` never seeds the pool; the
 * infer path narrows to the single valid subgroup dir.
 * D28 — gated to `game` domain.
 */
function gameArtSourceRef(opts?: { createIntent?: string; humanLabel?: { en: string; ko: string } }): SlotDef {
  return {
    path: 'visual/game-art',
    label: L.gameArtDesign,
    type: 'ui-source',
    required: true,
    uiSources: GAME_ART_SOURCE_SUBGROUPS,
    createIntent: opts?.createIntent ?? 'gen-game-art-desc',
    humanLabel: opts?.humanLabel ?? HL.gameArtDesign,
    applicableDomains: ['game'],
  };
}

/**
 * Game-art source slot as context (supplementary background input).
 * WS2 §3 — subgroup dispatcher, mirroring `uiSourceCtx`.
 * D28 — gated to `game` domain.
 */
function gameArtSourceCtx(opts?: { createIntent?: string; humanLabel?: { en: string; ko: string } }): SlotDef {
  return {
    path: 'visual/game-art',
    label: L.gameArtDesign,
    type: 'ui-source',
    required: false,
    uiSources: GAME_ART_SOURCE_SUBGROUPS,
    createIntent: opts?.createIntent ?? 'gen-game-art-desc',
    humanLabel: opts?.humanLabel ?? HL.gameArtDesign,
    applicableDomains: ['game'],
  };
}

/**
 * Asset-pool context slot, domain-gated (I6). Mirrors the `uiSourceCtx` /
 * `gameArtSourceCtx` D28 dispatch pattern: both `assetsCtx('service')` and
 * `assetsCtx('game')` are listed on a code/spec intent, and
 * `filterSlotsByDomain` keeps only the one matching the workspace domain so
 * `assets/service` ↔ `assets/game` can never both surface.
 *
 * The pool is loaded PATH-ONLY (stub, never eager-read) by
 * `loadResolvedArtifacts` — binary assets are surfaced as references the
 * code/spec job dereferences, not as prompt content (state.artifacts
 * Post-RAC SSOT).
 */
function assetsCtx(domain: import('./detection').Domain): SlotDef {
  return {
    path: domain === 'game' ? 'assets/game' : 'assets/service',
    label: L.assets,
    type: 'dir',
    required: false,
    humanLabel: HL.assets,
    applicableDomains: [domain],
  };
}

function emptyRef(): SlotDef {
  return { path: '', label: CHAT_HINT, type: 'file', required: false, emptyHint: CHAT_HINT };
}

/**
 * Codebase slot SSOT — single helper for both code-anchored jobs (ref)
 * and plan/design jobs in existing-project workspaces (context, auto).
 *
 * The two roles share UI/lock semantics; only Authority axis differs.
 * Pool-load behaviour (token cost 0): the codebase is served via the codebase
 * manifest (`listFiles('codebase')`) + the `codebase-channel` partial +
 * on-demand `read_file` / `list_files` tools — it is NEVER eager-loaded into
 * the pool. `loadResolvedArtifacts` enforces this by skipping codebase-scoped
 * refs (`isCodebaseScopedPath`: empty `''` or under `codebase/`); note that
 * `path.join(featurePath, '')` === `featurePath`, so without that guard the
 * empty path WOULD walk the whole feature tree (the `fern-grading-knife`
 * 22,131-node_modules-file / 7.85M-token decompose crash). The
 * `codebase-channel` partial gate is derived from `deriveCodebaseRole`, not
 * from pool inspection.
 */
function codebaseSlot(role: 'ref' | 'context', opts?: { auto?: boolean }): SlotDef {
  return {
    path: '',
    label: { en: 'Codebase', ko: '코드베이스' },
    type: 'dir',
    required: role === 'ref',
    locked: true,
    codebase: true,
    auto: opts?.auto ?? false,
    humanLabel: { en: 'Codebase', ko: '코드베이스' },
  };
}

function output(prefix: string, ext: string, label: { en: string; ko: string }, isPattern = true): OutputSpec {
  return { prefix, ext, label, isPattern, warnIfExists: true };
}

// ============================================
// Labels
// ============================================

const L = {
  /**
   * Plan slot label — domain-neutral. The plan document (PRD) is a single
   * document kind across every domain; a game project's PRD carries game
   * sections, but that structure comes from the `domain==='game'` overlay,
   * never from a different label or filename.
   */
  sources: { en: 'PRD', ko: '기획서' },
  designAll: { en: 'Design Documents', ko: '설계 문서' },
  systemDesign: { en: 'System Design', ko: '시스템 설계' },
  uiDesign: { en: 'UI Design', ko: 'UI 설계' },
  specDocs: { en: 'Spec Documents', ko: '스펙 문서' },
  figmaConfig: { en: 'Figma Config', ko: 'Figma 설정' },
  assets: { en: 'Assets', ko: '에셋' },
  feSystem: { en: 'fe-system-*.md', ko: 'fe-system-*.md' },
  beSystem: { en: 'be-system-*.md', ko: 'be-system-*.md' },
  apiContract: { en: 'api-contract-*.md', ko: 'api-contract-*.md' },
  uiTokens: { en: 'ui-tokens.json', ko: 'ui-tokens.json' },
  uiAssets: { en: 'ui-assets.json', ko: 'ui-assets.json' },
  uiSpec: { en: 'ui-spec.json', ko: 'ui-spec.json' },
  gameArtDesign: { en: 'Game Art Design', ko: '게임 아트 설계' },
  gameArtTokens: { en: 'game-art-tokens.json', ko: 'game-art-tokens.json' },
  gameArtAssets: { en: 'game-art-assets.json', ko: 'game-art-assets.json' },
  gameArtSpec: { en: 'game-art-spec.json', ko: 'game-art-spec.json' },
  handoffDesignMd: { en: 'DESIGN.md', ko: 'DESIGN.md' },
  handoffStyles: { en: 'styles.css', ko: 'styles.css' },
  handoffTokens: { en: 'tokens/*.css', ko: 'tokens/*.css' },
  handoffComponents: { en: 'components/*.html', ko: 'components/*.html' },
  handoffEntities: { en: 'entities/*.html', ko: 'entities/*.html' },
  handoffScreens: { en: 'screens/*.html', ko: 'screens/*.html' },
  handoffAssets: { en: 'assets/*.svg', ko: 'assets/*.svg' },
  spec: { en: 'spec document', ko: 'spec 문서' },
  plan: { en: 'PRD', ko: '기획서' },
  prd: { en: 'prd.md', ko: 'prd.md' },
  visual: { en: 'Generated Images', ko: '생성 이미지' },
} as const;

const HL = {
  prd: { en: 'PRD / Requirements', ko: '기획서' },
  systemDesign: { en: 'System Design Documents', ko: '시스템 설계 문서' },
  uiDesign: { en: 'UI Design Documents', ko: 'UI 설계 문서' },
  gameArtDesign: { en: 'Game Art Design Documents (game-art-tokens / game-art-assets / game-art-spec)', ko: '게임 아트 설계 문서 (game-art-tokens / game-art-assets / game-art-spec)' },
  specDocs: { en: 'Feature Spec Documents', ko: '기능 스펙 문서' },
  designAll: { en: 'Design Documents', ko: '설계 문서' },
  figmaConfig: { en: 'Figma Configuration', ko: 'Figma 설정 파일' },
  assets: { en: 'Asset Files', ko: '에셋 파일' },
  visual: { en: 'Generated Images', ko: '생성 이미지' },
} as const;

// ============================================
// Matrix Data
// ============================================

const SYS_DIR = 'architecture/system';
/**
 * Canonical ant-ui output directory.
 * UI design jobs (gen-ui-figma / gen-ui-desc) emit their tokens/assets/spec
 * JSON bundle here — this is the `UiSource.ant` slot. Figma and handoff UI
 * sources live under `visual/ui/{figma,handoff}/` and are selected via
 * `type: 'ui-source'` slots instead.
 */
const UI_DIR = 'visual/ui/ant';
/**
 * Canonical game-art output directory (D24-revised v8 — sub-sourced).
 * `gen-game-art-*` / `rev-game-art` design intents emit their tokens/assets/spec
 * JSON bundle under the `ant/` canonical sub-source — mirrors `visual/ui/ant/`.
 * `figma/` and `handoff/` sub-sources are Phase 5+ hooks (parser-only today).
 */
const GAME_ART_DIR = 'visual/game-art/ant';
/**
 * Handoff-producer output directories (Claude-Design-style bundle).
 * `gen-ui-desc` / `gen-game-art-desc` emit a DESIGN.md-rooted structured
 * bundle here — the same `UiSource.handoff` sub-source free-form user
 * uploads use, so the code job's existing handoff reader consumes both.
 * Package-shape SSOT: `templates/jobs/shared/injections/handoff-package-format.md`.
 */
const UI_HANDOFF_DIR = 'visual/ui/handoff';
const GAME_ART_HANDOFF_DIR = 'visual/game-art/handoff';
const SPEC_DIR = 'architecture/spec';
const SOURCES_DIR = 'plan';
// Asset pool RAC slots are domain-gated via `assetsCtx('service'|'game')`
// (D28 dispatch) — the bare parent `assets/` is never a slot path (that would
// walk both pools and violate I6). `assets/gen` stays for the visual job.
const ASSETS_GEN_DIR = 'assets/gen';

// `gen-sys-fe` matrix-default target stays `fe-system-*.md` only.
// Consumer-perspective `api-contract-{name}.md` is NOT a matrix default —
// `validateAndFixTargetFiles` seeds an `api-contract-*.md` placeholder and
// expands it ONLY when the LLM populates `consumedApis`. Adding the entry
// to `FE_OUTPUTS` would leak into `getDefaultTargetPaths` and force an
// empty `api-contract-main.md` artifact for every FE explicit submit
// without a consumer hint (Step 1c single-package collapse + Step 5
// coverage push). Revisit when a UI requirement to manually attach
// consumer snapshots emerges — that needs a dedicated `excludeFromDefault`
// flag, not a matrix-default expansion.
const FE_OUTPUTS: OutputSpec[] = [output('fe-system-', '.md', L.feSystem)];
const BE_OUTPUTS: OutputSpec[] = [output('be-system-', '.md', L.beSystem), output('api-contract-', '.md', L.apiContract)];
const FULLSTACK_OUTPUTS: OutputSpec[] = [...FE_OUTPUTS, ...BE_OUTPUTS];
const UI_OUTPUTS: OutputSpec[] = [
  output('ui-tokens', '.json', L.uiTokens, false),
  output('ui-assets', '.json', L.uiAssets, false),
  output('ui-spec', '.json', L.uiSpec, false),
];
const GAME_ART_OUTPUTS: OutputSpec[] = [
  output('game-art-tokens', '.json', L.gameArtTokens, false),
  output('game-art-assets', '.json', L.gameArtAssets, false),
  output('game-art-spec', '.json', L.gameArtSpec, false),
];
// Handoff bundle outputs (Claude-Design-style structured mini-project).
// `DESIGN.md` is the anchored root guide (9-section system document + an
// Artifacts manifest that makes every other file discoverable); the rest are
// open-ended patterns — the concrete file set is PRD/domain-driven at
// decompose time (three-ring family: common core / domain-biased / extension).
const HANDOFF_COMMON_OUTPUTS: OutputSpec[] = [
  output('DESIGN', '.md', L.handoffDesignMd, false),
  output('styles', '.css', L.handoffStyles, false),
  output('tokens/', '.css', L.handoffTokens),
  output('components/', '.html', L.handoffComponents),
  output('screens/', '.html', L.handoffScreens),
  output('assets/', '.svg', L.handoffAssets),
];
const HANDOFF_UI_OUTPUTS: OutputSpec[] = HANDOFF_COMMON_OUTPUTS;
// Game adds `entities/` (engine-rendered visual units) beside the common core.
const HANDOFF_GAME_ART_OUTPUTS: OutputSpec[] = [
  ...HANDOFF_COMMON_OUTPUTS,
  output('entities/', '.html', L.handoffEntities),
];
// Spec files are LLM-named per feature slug (`architecture/spec/{slug}.md`) —
// there is no fixed filename, so the canonical target is a pattern. `isPattern`
// only drives `formatOutputSpec`; matching (`matchesOutputSpec`) ignores it and
// keys on prefix+ext, so any `.md` still matches. With `false` the formatter
// produced a broken `architecture/spec/.md`; `true` yields `*.md`.
const SPEC_OUTPUTS: OutputSpec[] = [output('', '.md', L.spec, true)];

/**
 * Plan job output. `plan/prd.md` is the SUGGESTED single-doc default, not a
 * hard filename: the plan job lets the LLM name its doc(s) and may author
 * several under `plan/` for a MECE split (the concrete names are decided in
 * the sealed `<plan>` brief; an empty RAC target means "LLM will name").
 * This concrete `OutputSpec` remains the explicit-mode fallback + the FE
 * ActionConfigView default so the wizard still surfaces a sensible target.
 *
 * Domain-neutral: a game project's PRD carries game sections via the
 * `domain==='game'` overlay, NOT a different filename. Path/filename is never
 * a domain signal; the RAC treats anything under `plan/` as the `sources`
 * (requirements) role regardless of name (see canonical `SOURCES='plan'`).
 */
const PRD_OUTPUT: OutputSpec = output('prd', '.md', L.prd, false);
const PLAN_OUTPUTS: OutputSpec[] = [PRD_OUTPUT];

import type { IntentId } from './actions';
import { deriveFromIntent } from './actions';
import type { Domain } from './detection';
import { pickUiSource, pickGameArtSource } from './canonical';

/**
 * Cross-project code exploration (reference-codebase tools) applies to jobs that
 * write or design against code: code jobs and the spec / system-design design
 * intents. UI / game-art / plan / ask do not read sibling source. Drives the FE
 * reference picker's visibility; the BE tools themselves are additionally
 * discovery-gated on the tenant actually having a sibling project.
 */
export function supportsReferenceCodebase(intent: IntentId): boolean {
  const group = deriveFromIntent(intent).intentGroup;
  return group === 'code' || group === 'design-spec' || group === 'design-system';
}

/** The plan-job output spec — the suggested `plan/prd.md` single-doc default. */
export function getPlanOutputs(): OutputSpec[] {
  return [PRD_OUTPUT];
}

/**
 * Suggested single-doc plan filename. NOT a hard constraint — the plan job
 * lets the LLM name its doc(s); this is the default hidden from the `gen-plan`
 * source listing (`excludeFiles`) and the FE default.
 */
export const PLAN_OUTPUT_FILENAMES = ['prd.md'] as const;

/** Suggested single-doc plan filename (`prd.md`) — see PLAN_OUTPUT_FILENAMES. */
export function getCanonicalPlanFilename(): string {
  return 'prd.md';
}

/** Workspace-relative suggested single-doc plan path — `plan/prd.md`. */
export function getCanonicalPlanPath(): string {
  return `plan/${getCanonicalPlanFilename()}`;
}

/**
 * Returns the suggested `prd.md` filename if it exists in the given source
 * filenames, else `undefined`. Used as the single-doc / revise tie-break;
 * multi-doc plan workspaces are handled by the caller (all `plan/*.md`).
 */
export function pickExistingPlanFilename(
  sourceFileNames: readonly string[] | undefined,
): string | undefined {
  if (!sourceFileNames || sourceFileNames.length === 0) return undefined;
  return sourceFileNames.includes('prd.md') ? 'prd.md' : undefined;
}

// Tier presets per intent group — Phase 2 (D23: 'domain' removed from tiers).
// Domain is workspace-level (D22) and acts as the matrix gate, not a wizard
// tier. plan/spec expose no wizard tiers (genre/coreLoop live in the PRD prose
// authored by the universal game-domain overlay, not a basis tier) → the basis
// wizard is hidden and the panel routes straight to `config`.
//
// plan / spec      → []
// gen-sys-*        → [techTier]
// gen-ui-*         → [visualTier]                     (D18)
// gen-game-art-*   → [gameArtTier]                    (D18 / D28 — Phase 2)
// gen-code-*       → [techTier, visualTier, gameArtTier]
const PLAN_TIERS = [] as const;
const SYS_TIERS = ['techTier'] as const;
const UI_TIERS = ['visualTier'] as const;
const GAME_ART_TIERS = ['gameArtTier'] as const;
const CODE_TIERS = ['techTier', 'visualTier', 'gameArtTier'] as const;

// Per-domain seed presets (Phase 1; game backend added Game-Activation T3-a).
// `GAME_FE_PHASER` is the FE-only envelope (self-contained Phaser client).
// `GAME_FULL_PHASER` / `GAME_BE` open the backend as a first-class parity
// path (opt-in ceiling, not the default): a game server is expressed via
// `backend.framework` — `gameEngine` is a frontend-only field
// (`applyDomainDefaultsToBasis` skips it when stack==='backend'), so the seed
// carries stack only for the backend and lets detect/decompose resolve the
// server framework.
const GAME_FE_PHASER = { stack: 'frontend' as const, gameEngine: 'phaser' as const };
const GAME_FULL_PHASER = { stack: 'fullstack' as const, gameEngine: 'phaser' as const };
const GAME_BE = { stack: 'backend' as const };
const SERVICE_FE = { stack: 'frontend' as const };
const SERVICE_BE = { stack: 'backend' as const };
const SERVICE_FULL = { stack: 'fullstack' as const };

const MATRIX: Record<IntentId, ConfigSlots> = {
  // ── Plan ──────────────────────────────────
  'gen-plan': {
    refs: [refDir(SOURCES_DIR, L.sources, { required: false, humanLabel: HL.prd, excludeFiles: [...PLAN_OUTPUT_FILENAMES] })],
    context: [],
    // Single domain-neutral output (`plan/prd.md`). `excludeFiles` hides
    // the plan job's own output from the source listing so it does not
    // surface as an input candidate.
    target: { kind: 'generate', dir: SOURCES_DIR, outputs: PLAN_OUTPUTS },
    chatRequiresRefs: false,
    basis: { tiers: PLAN_TIERS },
  },
  'rev-plan': {
    refs: [refDir(SOURCES_DIR, L.sources, { createIntent: 'gen-plan', humanLabel: HL.prd })],
    context: [ctxDir(SOURCES_DIR, L.sources, { excludeSelectedRefs: true })],
    target: { kind: 'revise' },
    buildDisabled: true,
    refsSingleSelect: true,
    // rev-* intents derive every basis decision from the document under
    // review — exposing tier pickers would invite the user to overwrite
    // settings already encoded in the artifact.
    basis: { tiers: [] },
  },

  // ── System Design: Gen ─────────────────────
  // Stack identity is part of the intent (`-fe` / `-be` / `-full`) — the
  // wizard hides the Stack step via `lockedStack`, and BE detect's
  // `applyDomainDefaultsToBasis` force-overrides any inherited stack so
  // mention-path / cross-group leftovers cannot override it.
  'gen-sys-fe': {
    refs: [refDir(SOURCES_DIR, L.sources, { createIntent: 'gen-plan', humanLabel: HL.prd })],
    context: [ctxDir(SYS_DIR, L.systemDesign, { humanLabel: HL.systemDesign })],
    target: { kind: 'generate', dir: SYS_DIR, outputs: FE_OUTPUTS },
    basis: {
      tiers: SYS_TIERS,
      defaults: { service: SERVICE_FE, game: GAME_FE_PHASER },
      lockedStack: 'frontend',
    },
  },
  'gen-sys-be': {
    refs: [refDir(SOURCES_DIR, L.sources, { createIntent: 'gen-plan', humanLabel: HL.prd })],
    context: [ctxDir(SYS_DIR, L.systemDesign, { humanLabel: HL.systemDesign })],
    target: { kind: 'generate', dir: SYS_DIR, outputs: BE_OUTPUTS },
    // game default present so a game backend design is a first-class parity
    // path — `lockedStack` pins backend, so it never falls to the service
    // seed (Game-Activation T3-a).
    basis: { tiers: SYS_TIERS, defaults: { service: SERVICE_BE, game: GAME_BE }, lockedStack: 'backend' },
  },
  'gen-sys-full': {
    refs: [refDir(SOURCES_DIR, L.sources, { createIntent: 'gen-plan', humanLabel: HL.prd })],
    context: [ctxDir(SYS_DIR, L.systemDesign, { humanLabel: HL.systemDesign })],
    target: { kind: 'generate', dir: SYS_DIR, outputs: FULLSTACK_OUTPUTS },
    // game seed is FE+BE (not FE-only): `GAME_FULL_PHASER` seeds a fullstack
    // stack with phaser on the frontend half so a fullstack game design
    // seeds both halves instead of leaving the backend unmodeled
    // (Game-Activation T3-a).
    basis: {
      tiers: SYS_TIERS,
      defaults: { service: SERVICE_FULL, game: GAME_FULL_PHASER },
      lockedStack: 'fullstack',
    },
  },

  // ── System Design: Rev ─────────────────────
  'rev-sys': {
    refs: [refDir(SYS_DIR, L.systemDesign, { createIntent: 'gen-sys-full', humanLabel: HL.systemDesign })],
    context: [ctxDir(SOURCES_DIR, L.sources, { createIntent: 'gen-plan', humanLabel: HL.prd })],
    target: { kind: 'revise' },
    buildDisabled: true,
    refsSingleSelect: true,
    // Revising system design on an existing codebase needs the same techTier
    // grounding as gen-sys-* (was [] — under-specified, not a deliberate opt-out).
    basis: { tiers: SYS_TIERS },
  },

  // ── UI Design: Gen ─────────────────────────
  'gen-ui-figma': {
    refs: [refFile('visual/ui/figma/figma.json', L.figmaConfig, { locked: true, humanLabel: HL.figmaConfig })],
    context: [ctxDir(SOURCES_DIR, L.sources, { createIntent: 'gen-plan', humanLabel: HL.prd })],
    target: { kind: 'generate', dir: UI_DIR, outputs: UI_OUTPUTS },
    // figma.json (locked ref) is the visual authority — the figma source
    // already encodes every visualTier decision the wizard would expose.
    // Surfacing visualTier here would force the user through a wizard
    // whose answers figma immediately overrides. BE matches: the
    // `hasUiDoc=true` runtime suppressor in `tier-matrix.ts` already
    // closes visualTier post-RAC; this just aligns the static gate.
    basis: { tiers: [] },
  },
  'gen-ui-desc': {
    refs: [refDir(SOURCES_DIR, L.sources, { createIntent: 'gen-plan', humanLabel: HL.prd })],
    context: [],
    // Handoff producer (repurposed): PRD → Claude-Design-style bundle under
    // `visual/ui/handoff/` (DESIGN.md root + shared-layer dirs). The ant-JSON
    // trio is produced only by the figma pipeline (`gen-ui-figma`); a future
    // `gen-ui-from-handoff` converter intent covers handoff → ant JSON.
    target: { kind: 'generate', dir: UI_HANDOFF_DIR, outputs: HANDOFF_UI_OUTPUTS },
    chatRequiresRefs: false,
    basis: { tiers: UI_TIERS },
  },

  // ── UI Design: Rev ─────────────────────────
  'rev-ui': {
    refs: [uiSourceRef({ createIntent: 'gen-ui-desc' })],
    context: [ctxDir(SOURCES_DIR, L.sources, { createIntent: 'gen-plan', humanLabel: HL.prd })],
    target: { kind: 'revise' },
    buildDisabled: true,
    refsSingleSelect: true,
    basis: { tiers: [] },
  },

  // ── Game Art Design (Phase 2 — D17/D28. game domain only; ActionsPanel hides
  // the entire group when workspace.domain === 'service' via the matrix
  // gate TIER_DOMAIN_MATRIX.gameArtTier === ['game']) ────────────────
  'gen-game-art-figma': {
    refs: [refFile('visual/ui/figma/figma.json', L.figmaConfig, { locked: true, humanLabel: HL.figmaConfig })],
    context: [ctxDir(SOURCES_DIR, L.sources, { createIntent: 'gen-plan', humanLabel: HL.prd }), assetsCtx('game')],
    target: { kind: 'generate', dir: GAME_ART_DIR, outputs: GAME_ART_OUTPUTS },
    // figma.json (locked ref) is the game-art authority — same reasoning
    // as `gen-ui-figma` above. No wizard tier; the phaser engine seeds via
    // `defaults` and gameplay axes come from the PRD.
    basis: { tiers: [], defaults: { game: GAME_FE_PHASER } },
  },
  'gen-game-art-desc': {
    refs: [refDir(SOURCES_DIR, L.sources, { createIntent: 'gen-plan', humanLabel: HL.prd })],
    context: [assetsCtx('game')],
    // Handoff producer (repurposed) — game peer of `gen-ui-desc`. Emits the
    // same DESIGN.md-rooted bundle under `visual/game-art/handoff/` with the
    // game-biased `entities/` ring added.
    target: { kind: 'generate', dir: GAME_ART_HANDOFF_DIR, outputs: HANDOFF_GAME_ART_OUTPUTS },
    chatRequiresRefs: false,
    basis: { tiers: GAME_ART_TIERS, defaults: { game: GAME_FE_PHASER } },
  },
  'rev-game-art': {
    refs: [gameArtSourceRef()],
    context: [ctxDir(SOURCES_DIR, L.sources, { createIntent: 'gen-plan', humanLabel: HL.prd })],
    target: { kind: 'revise' },
    buildDisabled: true,
    refsSingleSelect: true,
    basis: { tiers: [] },
  },
  'explain-game-art': {
    refs: [gameArtSourceRef()],
    context: [],
    target: { kind: 'chat-only', hint: EXPLAIN_TARGET_HINT },
  },

  // ── Spec ──────────────────────────────────
  'gen-spec': {
    // Plan slot label is the domain-neutral "PRD" / "기획서" in every domain.
    refs: [refDir(SOURCES_DIR, L.sources, { createIntent: 'gen-plan', humanLabel: HL.prd })],
    // D28 — both design sources are listed; `applicableDomains` filters
    // `ui-source` (service) vs `game-art-source` (game) per workspace domain
    // (Game-Activation T1-b). Without the game-art slot a game spec would be
    // authored against ui-* documents it can never load.
    context: [
      ctxDir(SYS_DIR, L.systemDesign, { createIntent: 'gen-sys-full', humanLabel: HL.systemDesign }),
      uiSourceCtx({ createIntent: 'gen-ui-desc' }),
      gameArtSourceCtx(),
      ctxDir(SPEC_DIR, L.specDocs, { createIntent: 'gen-spec', humanLabel: HL.specDocs }),
      assetsCtx('service'),
      assetsCtx('game'),
    ],
    target: { kind: 'generate', dir: SPEC_DIR, outputs: SPEC_OUTPUTS },
    chatRequiresRefs: false,
    // Code-grounded design doc → activate techTier grounding (same gate as
    // gen-sys-*). A spec written against an existing codebase must reference the
    // real stack's conventions; the design-side techTier partials supply that.
    basis: { tiers: SYS_TIERS },
  },
  'rev-spec': {
    refs: [refDir(SPEC_DIR, L.specDocs, { createIntent: 'gen-spec', humanLabel: HL.specDocs })],
    // D28 — game-art-source listed next to ui-source; `applicableDomains`
    // resolves the dispatch per domain (Game-Activation T1-b).
    context: [
      ctxDir(SYS_DIR, L.systemDesign, { createIntent: 'gen-sys-full', humanLabel: HL.systemDesign }),
      ctxDir(SOURCES_DIR, L.sources, { createIntent: 'gen-plan', humanLabel: HL.prd }),
      uiSourceCtx({ createIntent: 'gen-ui-desc' }),
      gameArtSourceCtx(),
      ctxDir(SPEC_DIR, L.specDocs, { excludeSelectedRefs: true, createIntent: 'gen-spec', humanLabel: HL.specDocs }),
      assetsCtx('service'),
      assetsCtx('game'),
    ],
    target: { kind: 'revise' },
    buildDisabled: true,
    refsSingleSelect: true,
    // Revising a spec on an existing codebase needs techTier grounding (was []).
    basis: { tiers: SYS_TIERS },
  },

  // ── Code: Gen (3 pipeline-specific intents) ──
  // D28 — both ui-source (service-only) and game-art-source (game-only)
  // are listed; the SlotDef.applicableDomains gate filters which one is
  // active per workspace domain so neither domain ever sees the other's
  // surface.
  'gen-code-sys': {
    refs: [
      refDir(SYS_DIR, L.systemDesign, { createIntent: 'gen-sys-full', humanLabel: HL.systemDesign }),
      uiSourceRef({ createIntent: 'gen-ui-desc' }),
      gameArtSourceRef(),
    ],
    context: [
      ctxDir(SOURCES_DIR, L.sources, { createIntent: 'gen-plan', humanLabel: HL.prd }),
      assetsCtx('service'),
      assetsCtx('game'),
    ],
    target: { kind: 'codebase' },
    basis: { tiers: CODE_TIERS, defaults: { game: GAME_FE_PHASER } },
  },
  'gen-code-spec': {
    refs: [refDir(SPEC_DIR, L.specDocs, { createIntent: 'gen-spec', humanLabel: HL.specDocs })],
    context: [
      ctxDir(SYS_DIR, L.systemDesign, { createIntent: 'gen-sys-full', humanLabel: HL.systemDesign }),
      uiSourceCtx({ createIntent: 'gen-ui-desc' }),
      gameArtSourceCtx(),
      ctxDir(SOURCES_DIR, L.sources, { createIntent: 'gen-plan', humanLabel: HL.prd }),
      assetsCtx('service'),
      assetsCtx('game'),
    ],
    target: { kind: 'codebase' },
    refsSingleSelect: true,
    basis: { tiers: CODE_TIERS, defaults: { game: GAME_FE_PHASER } },
  },
  'gen-code-directive': {
    refs: [emptyRef()],
    context: [
      uiSourceCtx({ createIntent: 'gen-ui-desc' }),
      gameArtSourceCtx(),
      ctxDir(SOURCES_DIR, L.sources, { createIntent: 'gen-plan', humanLabel: HL.prd }),
      ctxDir(SPEC_DIR, L.specDocs, { createIntent: 'gen-spec', humanLabel: HL.specDocs }),
      assetsCtx('service'),
      assetsCtx('game'),
    ],
    target: { kind: 'codebase' },
    buildDisabled: true,
    basis: { tiers: CODE_TIERS, defaults: { game: GAME_FE_PHASER } },
  },

  // ── Visual ────────────────────────────────
  'gen-visual-logo': {
    refs: [emptyRef()],
    context: [],
    target: { kind: 'generate', dir: ASSETS_GEN_DIR, outputs: [] },
    buildDisabled: true,
  },
  'gen-visual-icon': {
    refs: [emptyRef()],
    context: [],
    target: { kind: 'generate', dir: ASSETS_GEN_DIR, outputs: [] },
    buildDisabled: true,
  },
  'gen-visual-hero': {
    refs: [emptyRef()],
    context: [],
    target: { kind: 'generate', dir: ASSETS_GEN_DIR, outputs: [] },
    buildDisabled: true,
  },
  'gen-visual-illustration': {
    refs: [emptyRef()],
    context: [],
    target: { kind: 'generate', dir: ASSETS_GEN_DIR, outputs: [] },
    buildDisabled: true,
  },
  'explain-visual': {
    refs: [refDir(ASSETS_GEN_DIR, L.visual, { humanLabel: HL.visual })],
    context: [],
    target: { kind: 'chat-only', hint: EXPLAIN_TARGET_HINT },
  },

  // ── Learn ─────────────────────────────────
  'gen-learn': {
    refs: [codebaseSlot('ref')],
    context: [],
    target: { kind: 'codebase' },
  },

  // ── Explain (cross-domain) ────────────────
  'explain-code': {
    refs: [codebaseSlot('ref')],
    context: [],
    target: { kind: 'chat-only', hint: EXPLAIN_TARGET_HINT },
  },
  'explain-ui': {
    refs: [uiSourceRef()],
    context: [],
    target: { kind: 'chat-only', hint: EXPLAIN_TARGET_HINT },
  },
  'explain-sys': {
    refs: [refDir(SYS_DIR, L.systemDesign, { humanLabel: HL.systemDesign })],
    context: [],
    target: { kind: 'chat-only', hint: EXPLAIN_TARGET_HINT },
  },
  'explain-spec': {
    refs: [refDir(SPEC_DIR, L.specDocs, { humanLabel: HL.specDocs })],
    context: [],
    target: { kind: 'chat-only', hint: EXPLAIN_TARGET_HINT },
  },
  'explain-plan': {
    refs: [refDir(SOURCES_DIR, L.sources, { humanLabel: HL.prd })],
    context: [],
    target: { kind: 'chat-only', hint: EXPLAIN_TARGET_HINT },
  },

  // ── Ask ─────────────────────────────────
  'ask-evaluate': {
    refs: [emptyRef()],
    context: [],
    target: { kind: 'chat-only', hint: ASK_TARGET_HINT },
  },
  'ask-ant': {
    refs: [emptyRef()],
    context: [],
    target: { kind: 'chat-only', hint: ASK_TARGET_HINT },
  },
  'ask-general': {
    refs: [emptyRef()],
    context: [],
    target: { kind: 'chat-only', hint: ASK_TARGET_HINT },
  },
};

// ============================================
// Public API
// ============================================

/**
 * Workspace context affecting RAC slot composition.
 *
 * Codebase Channel SSOT — when `hasCodebase` is true, plan/design intents
 * receive an auto-injected `codebaseSlot('context', { auto: true })` so
 * the workspace's existing code is recognised as binding context. This
 * channel is dynamic (workspace-state-driven) and lives outside the
 * static MATRIX so the matrix body remains observable as a pure SSOT.
 */
export interface WorkspaceSlotContext {
  /** Workspace contains an existing codebase (disk walk OR memory index). */
  hasCodebase?: boolean;
}

/**
 * Intents that receive the auto codebase context slot when `hasCodebase`
 * is true: plan / design (system / spec / ui / game-art) intents plus the
 * code gen intents (existing-code awareness is workspace-presence-driven —
 * the spec/sys/directive stays the ref authority, the codebase is binding
 * context). code-anchored intents (explain-code / gen-learn) already
 * declare a static `codebaseSlot('ref')` and are excluded.
 */
const CODEBASE_CONTEXT_INTENTS = new Set<IntentId>([
  'gen-plan',
  'rev-plan',
  'explain-plan',
  'gen-sys-fe',
  'gen-sys-be',
  'gen-sys-full',
  'rev-sys',
  'explain-sys',
  'gen-ui-figma',
  'gen-ui-desc',
  'rev-ui',
  'explain-ui',
  'gen-game-art-figma',
  'gen-game-art-desc',
  'rev-game-art',
  'explain-game-art',
  'gen-spec',
  'rev-spec',
  'explain-spec',
  'gen-code-sys',
  'gen-code-spec',
  'gen-code-directive',
]);

function isCodebaseContextEligibleIntent(intent: IntentId): boolean {
  return CODEBASE_CONTEXT_INTENTS.has(intent);
}

/**
 * Get the refs/context/target configuration for a given intent.
 * Returns null if the intent is not defined in the matrix.
 *
 * Note — the returned `ConfigSlots` is the FULL definition (all slots).
 * Use `filterSlotsByDomain` to drop slots whose `applicableDomains` does
 * not include the active workspace domain (D28).
 *
 * `workspaceContext.hasCodebase=true` causes plan/design intents to
 * receive an auto codebase context slot (Codebase Channel SSOT).
 */
export function getConfigSlots(
  intent: IntentId,
  workspaceContext?: WorkspaceSlotContext,
): ConfigSlots | null {
  const raw = MATRIX[intent] ?? null;
  if (!raw) return null;
  if (!workspaceContext?.hasCodebase) return raw;
  if (!isCodebaseContextEligibleIntent(intent)) return raw;
  // Dynamic injection: prepend the auto codebase context slot. Prepend
  // (not append) so consumers iterating contexts encounter the codebase
  // hint first — UI slot ordering and prompt enumeration both benefit.
  return {
    ...raw,
    context: [codebaseSlot('context', { auto: true }), ...raw.context],
  };
}

/**
 * Codebase Channel SSOT — single source for the partial-gate variable.
 *
 * Returns the role this intent assigns to the codebase, or `undefined`
 * when the codebase is not in scope for this intent / workspace pair.
 * Derived independently of the artifact pool because the codebase slot's
 * `path: ''` means `loadResolvedArtifacts` never walks code body into the
 * pool — partial activation must therefore be intent + workspace driven.
 *
 *   - 'ref'      → code-anchored intents (explain-code / gen-learn)
 *   - 'context'  → plan/design/code-gen intents in an existing-project workspace
 *   - undefined  → greenfield workspace OR non-eligible intent
 */
export function deriveCodebaseRole(
  intent: IntentId | undefined,
  workspaceContext?: WorkspaceSlotContext,
): 'ref' | 'context' | undefined {
  if (!intent) return undefined;
  const raw = MATRIX[intent];
  if (!raw) return undefined;
  if (raw.refs.some(s => s.codebase === true)) return 'ref';
  if (workspaceContext?.hasCodebase && isCodebaseContextEligibleIntent(intent)) {
    return 'context';
  }
  return undefined;
}

/**
 * D28 — drop slots whose `applicableDomains` does not include `domain`.
 * Slots without `applicableDomains` are always kept (domain-agnostic).
 *
 * Used by FE (`ActionConfigView`) and BE (RAC ref/ctx selection) to render
 * only the surface that the workspace's domain actually owns. The matrix
 * lists both `ui-source` and `game-art-source` slots on every code intent
 * and this filter resolves the dispatch.
 */
export function filterSlotsByDomain(
  slots: ConfigSlots,
  domain: import('./detection').Domain | undefined,
): ConfigSlots {
  const allow = (slot: SlotDef): boolean =>
    !slot.applicableDomains
      || (!!domain && slot.applicableDomains.includes(domain));
  return {
    ...slots,
    refs: slots.refs.filter(allow),
    context: slots.context.filter(allow),
  };
}

/**
 * Domain-aware ConfigSlots SSOT — composes `filterSlotsByDomain` so every
 * FE / BE consumer that needs a workspace-correct view of an intent's
 * slots obtains it from a single helper.
 *
 * The plan slot is domain-neutral (single `plan/prd.md`), so no per-domain
 * label / filename rewrite is needed — the static matrix labels are already
 * correct. `filterSlotsByDomain` still performs the real domain work
 * (dropping wrong-domain slots like `visual/ui` vs `visual/game-art`).
 *
 * `domain` is intentionally non-optional. Workspaces always carry a
 * default (`'service'`) so callers must surface their fallback at the
 * call site rather than letting `undefined` quietly pick service.
 *
 * `workspaceContext.hasCodebase=true` forwards into `getConfigSlots` to
 * activate the auto codebase context slot for plan/design intents.
 */
export function getConfigSlotsForDomain(
  intent: IntentId,
  domain: Domain,
  workspaceContext?: WorkspaceSlotContext,
): ConfigSlots | null {
  const raw = getConfigSlots(intent, workspaceContext);
  if (!raw) return null;
  return filterSlotsByDomain(raw, domain);
}

/**
 * Check if a filename matches an OutputSpec pattern.
 * Used by UI to show conflict warnings on gen intents.
 */
export function matchesOutputSpec(filename: string, spec: OutputSpec): boolean {
  return filename.startsWith(spec.prefix) && filename.endsWith(spec.ext);
}

/**
 * Derive default target paths from the matrix for a given intent.
 *
 * Mirrors the FE behaviour in `ActionConfigView.tsx` so that BE detect
 * paths see the same canonical target list when `actionMetadata.target`
 * is absent (chat-driven explicit submit, mention-path with explicit
 * toggle, …). Returns:
 *
 *   - `kind: 'generate'` + outputs → `[`${dir}/${formatOutputSpec(o)}`]`
 *   - `kind: 'generate'` + no outputs → `[dir]`
 *   - `kind: 'revise'` + `opts.refs?.length === 1` → `opts.refs`
 *     (the single selected ref IS the target — every `revise` intent
 *     carries `refsSingleSelect: true`, so refs.length > 1 is invalid
 *     and we return undefined to defer to the caller's error path)
 *   - any other kind / shape → `undefined`
 *
 * dusk-mounding-pilot regression — the explicit branch of `detect/index.ts`
 * previously trusted `metadata.target` verbatim and produced an empty
 * RAC.target for chat-driven `gen-plan`, which then erased the system
 * prompt's "Target Path" section and let the LLM hallucinate a non-canonical
 * target. Routing the explicit branch through this helper restores parity
 * with the infer branch and the FE.
 *
 * marble-barking-grass regression — chat-driven `rev-spec` (or any
 * `target.kind === 'revise'` intent) without ActionConfigView-supplied
 * `metadata.target` crashed mid-decompose with "requires exactly one
 * target file, got 0" because `kind !== 'generate'` returned undefined
 * unconditionally. The `revise` branch closes that loop by promoting the
 * single-selected ref to target, matching the matrix's "selected ref IS
 * the target" semantics.
 */
export function getDefaultTargetPaths(
  intent: IntentId,
  // Retained for call-site compatibility; plan output is domain-neutral
  // (`plan/prd.md`) so the target no longer varies by domain.
  _domain?: Domain,
  opts?: { refs?: string[] },
): string[] | undefined {
  const slots = getConfigSlots(intent);
  const target = slots?.target;
  if (!target) return undefined;

  if (target.kind === 'revise') {
    const refs = opts?.refs ?? [];
    if (refs.length > 0) {
      // Design revise (rev-ui / rev-game-art): the selected ref sub-source is
      // the single discriminator — mirror of design/_shared/reviseTarget.ts:
      //   figma   → regenerate the surface's ant JSON trio (figma → ant compile)
      //   handoff → revise the bundle in place → the refs ARE the target
      //             (a whole handoff bundle is one multi-file selection)
      //   ant     → revise the JSON doc(s) in place → the refs ARE the target
      //   null    → unclassified (e.g. tree-parent dir path) → refs (legacy default)
      // Sub-source exclusivity over multi-file selections is guaranteed
      // upstream by normalize*SourceRefs. This pure helper only supplies the
      // pre-decompose default (FE display / RAC.target / chat announcement).
      if (intent === 'rev-ui' || intent === 'rev-game-art') {
        const sub = intent === 'rev-ui' ? pickUiSource(refs) : pickGameArtSource(refs);
        if (sub === 'figma') {
          return intent === 'rev-ui'
            ? UI_OUTPUTS.map(o => `${UI_DIR}/${formatOutputSpec(o)}`)
            : GAME_ART_OUTPUTS.map(o => `${GAME_ART_DIR}/${formatOutputSpec(o)}`);
        }
        return [...refs];
      }
      // Non-design revise (rev-spec / rev-sys): refsSingleSelect — the single
      // selected ref IS the target; a multi-selection stays invalid.
      if (refs.length === 1) return [...refs];
      return undefined;
    }
    // No-ref fallback for `rev-plan`: a triage redirect from another job
    // (e.g. code → plan) carries intent only, with no selected ref. Unlike
    // other revise intents (rev-sys / rev-ui — which revise one of
    // several arbitrary files and genuinely need a ref), the plan has a single
    // canonical document — the same file `gen-plan` writes (`plan/prd.md`).
    // Fall back to it so the revise target resolves instead of leaving
    // `target` empty (which crashes the planner generate guard).
    if (intent === 'rev-plan') return getDefaultTargetPaths('gen-plan');
    return undefined;
  }

  if (target.kind !== 'generate') return undefined;
  if (target.outputs.length === 0) return [target.dir];

  // Plan output is domain-neutral (`plan/prd.md`) — the generic mapping
  // below already yields the single canonical path; no per-domain branch.
  return target.outputs.map(o => `${target.dir}/${formatOutputSpec(o)}`);
}

/** @deprecated Use matchesOutputSpec */
export const matchesExpectedFile = matchesOutputSpec;

// ============================================
// Activation Policy — System Rules
// ============================================
// These functions encode Layer 1 rules derivable from slot structure.
// They are consumed by the FE policy hook (useActionFooterPolicy).

/** Whether the slots contain selectable (non-empty, non-directive) ref definitions. */
export function hasRealRefSlots(slots: ConfigSlots): boolean {
  return slots.refs.some(r => !r.emptyHint && (r.path || r.codebase));
}

/**
 * Default: chat ref gate mirrors build ref gate.
 * Explicit `chatRequiresRefs` flag overrides when present.
 */
export function deriveChatNeedsRefs(slots: ConfigSlots): boolean {
  if (slots.chatRequiresRefs !== undefined) return slots.chatRequiresRefs;
  return deriveBuildNeedsRefs(slots);
}

/**
 * System rule: build requires refs when real ref slots exist AND not explicitly opted out.
 * Returns false when: no real ref slots (directive-only), OR `buildRequiresRefs: false`.
 */
export function deriveBuildNeedsRefs(slots: ConfigSlots): boolean {
  if (slots.buildRequiresRefs === false) return false;
  return hasRealRefSlots(slots);
}

// ============================================
// TargetDef Type Guards
// ============================================

export function isGenerateTarget(target: TargetDef): target is Extract<TargetDef, { kind: 'generate' }> {
  return target.kind === 'generate';
}

export function isReviseTarget(target: TargetDef): target is Extract<TargetDef, { kind: 'revise' }> {
  return target.kind === 'revise';
}

export function isCodebaseTarget(target: TargetDef): target is Extract<TargetDef, { kind: 'codebase' }> {
  return target.kind === 'codebase';
}

export function isChatOnlyTarget(target: TargetDef): target is Extract<TargetDef, { kind: 'chat-only' }> {
  return target.kind === 'chat-only';
}

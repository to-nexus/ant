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
 * subdirectories under `outputs/design/ui/`. The slot is hard-exclusive:
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
    dir: 'outputs/design/ui/ant',
    label: { en: 'Ant Canonical', ko: 'Ant 설계 문서' },
    humanLabel: { en: 'Ant Canonical UI Documents (ui-tokens / ui-assets / ui-spec)', ko: 'Ant 설계 문서 (ui-tokens / ui-assets / ui-spec)' },
  },
  {
    id: 'figma',
    dir: 'outputs/design/ui/figma',
    label: { en: 'Figma', ko: 'Figma' },
    humanLabel: { en: 'Figma Workfile Reference (figma.json, interpreted via MCP)', ko: 'Figma 작업 파일 참조 (figma.json, MCP 로 해석)' },
  },
  {
    id: 'handoff',
    dir: 'outputs/design/ui/handoff',
    label: { en: 'Handoff', ko: '핸드오프' },
    humanLabel: { en: 'Handoff (CLAUDE DESIGN)', ko: '핸드오프 (CLAUDE DESIGN)' },
  },
];

/**
 * UI source slot as refs (primary authoritative input).
 * D28 — gated to `service` domain. Game workspaces consume `game-art-source`
 * via `gameArtSourceRef` / `gameArtSourceCtx` instead.
 */
function uiSourceRef(opts?: { createIntent?: string; humanLabel?: { en: string; ko: string } }): SlotDef {
  return {
    path: 'outputs/design/ui',
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
    path: 'outputs/design/ui',
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
 * D24 — flat structure, no sub-source dispatcher (single dir entry).
 * D28 — gated to `game` domain.
 */
function gameArtSourceRef(opts?: { createIntent?: string; humanLabel?: { en: string; ko: string } }): SlotDef {
  return {
    path: GAME_ART_DIR,
    label: L.gameArtDesign,
    type: 'dir',
    required: true,
    createIntent: opts?.createIntent ?? 'gen-game-art-desc',
    humanLabel: opts?.humanLabel ?? HL.gameArtDesign,
    applicableDomains: ['game'],
  };
}

/**
 * Game-art source slot as context (supplementary background input).
 * D24 — flat structure, single dir entry.
 * D28 — gated to `game` domain.
 */
function gameArtSourceCtx(opts?: { createIntent?: string; humanLabel?: { en: string; ko: string } }): SlotDef {
  return {
    path: GAME_ART_DIR,
    label: L.gameArtDesign,
    type: 'dir',
    required: false,
    createIntent: opts?.createIntent ?? 'gen-game-art-desc',
    humanLabel: opts?.humanLabel ?? HL.gameArtDesign,
    applicableDomains: ['game'],
  };
}

function emptyRef(): SlotDef {
  return { path: '', label: CHAT_HINT, type: 'file', required: false, emptyHint: CHAT_HINT };
}

function codebaseRef(): SlotDef {
  return {
    path: '',
    label: { en: 'Codebase', ko: '코드베이스' },
    type: 'dir',
    required: true,
    locked: true,
    codebase: true,
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
  sources: { en: 'PRD', ko: 'PRD' },
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
  spec: { en: 'spec-*.md', ko: 'spec-*.md' },
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

const SYS_DIR = 'outputs/design/system';
/**
 * Canonical ant-ui output directory.
 * UI design jobs (gen-ui-figma / gen-ui-desc) emit their tokens/assets/spec
 * JSON bundle here — this is the `UiSource.ant` slot. Figma and handoff UI
 * sources live under `outputs/design/ui/{figma,handoff}/` and are selected
 * via `type: 'ui-source'` slots instead.
 */
const UI_DIR = 'outputs/design/ui/ant';
/**
 * Canonical game-art output directory (D24-revised v8 — sub-sourced).
 * `gen-game-art-*` / `rev-game-art` design intents emit their tokens/assets/spec
 * JSON bundle under the `ant/` canonical sub-source — mirrors `outputs/design/ui/ant/`.
 * `figma/` and `handoff/` sub-sources are Phase 5+ hooks (parser-only today).
 */
const GAME_ART_DIR = 'outputs/design/game-art/ant';
const SPEC_DIR = 'outputs/design/spec';
const SOURCES_DIR = 'inputs/sources';
/**
 * Parent assets directory (Phase 2 — D19-revised). Workspace.domain decides
 * the active sub-pool (`inputs/assets/service/` or `inputs/assets/game/`) at
 * the asset handler layer; the matrix slot here exposes the parent so the FE
 * Artifacts panel can show whichever pool the workspace owns.
 */
const ASSETS_DIR = 'inputs/assets';
const ASSETS_GEN_DIR = 'inputs/assets/gen';

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
const SPEC_OUTPUTS: OutputSpec[] = [output('spec-', '.md', L.spec)];

import type { IntentId } from './actions';

// Tier presets per intent group — Phase 2 (D23: 'domain' removed from tiers).
// Domain is workspace-level (D22) and acts as the matrix gate, not a wizard
// tier. Service-domain plan/spec wizards thus auto-collapse (gameContentTier
// is game-only → no active tier rows for service → wizard hidden).
//
// plan / spec      → [gameContentTier]
// gen-sys-*        → [techTier, gameContentTier]
// gen-ui-*         → [visualTier, gameContentTier]                     (D18)
// gen-game-art-*   → [gameArtTier, gameContentTier]                    (D18 / D28 — Phase 2)
// gen-code-*       → [techTier, visualTier, gameArtTier, gameContentTier]
const PLAN_TIERS = ['gameContentTier'] as const;
const SYS_TIERS = ['techTier', 'gameContentTier'] as const;
const UI_TIERS = ['visualTier', 'gameContentTier'] as const;
const GAME_ART_TIERS = ['gameArtTier', 'gameContentTier'] as const;
const CODE_TIERS = ['techTier', 'visualTier', 'gameArtTier', 'gameContentTier'] as const;

// Per-domain seed presets (Phase 1).
const GAME_FE_PHASER = { stack: 'frontend' as const, gameEngine: 'phaser' as const };
const SERVICE_FE = { stack: 'frontend' as const };
const SERVICE_BE = { stack: 'backend' as const };
const SERVICE_FULL = { stack: 'fullstack' as const };

const MATRIX: Record<IntentId, ConfigSlots> = {
  // ── Plan ──────────────────────────────────
  'gen-plan': {
    refs: [refDir(SOURCES_DIR, L.sources, { required: false, humanLabel: HL.prd, excludeFiles: ['prd.md'] })],
    context: [],
    target: { kind: 'generate', dir: SOURCES_DIR, outputs: [output('prd', '.md', L.prd, false)] },
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
    basis: { tiers: SYS_TIERS, defaults: { service: SERVICE_BE }, lockedStack: 'backend' },
  },
  'gen-sys-full': {
    refs: [refDir(SOURCES_DIR, L.sources, { createIntent: 'gen-plan', humanLabel: HL.prd })],
    context: [ctxDir(SYS_DIR, L.systemDesign, { humanLabel: HL.systemDesign })],
    target: { kind: 'generate', dir: SYS_DIR, outputs: FULLSTACK_OUTPUTS },
    basis: {
      tiers: SYS_TIERS,
      defaults: { service: SERVICE_FULL, game: GAME_FE_PHASER },
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
    basis: { tiers: [] },
  },

  // ── UI Design: Gen ─────────────────────────
  'gen-ui-figma': {
    refs: [refFile('outputs/design/ui/figma/figma.json', L.figmaConfig, { locked: true, humanLabel: HL.figmaConfig })],
    context: [ctxDir(SOURCES_DIR, L.sources, { createIntent: 'gen-plan', humanLabel: HL.prd })],
    target: { kind: 'generate', dir: UI_DIR, outputs: UI_OUTPUTS },
    basis: { tiers: UI_TIERS },
  },
  'gen-ui-desc': {
    refs: [refDir(SOURCES_DIR, L.sources, { createIntent: 'gen-plan', humanLabel: HL.prd })],
    context: [],
    target: { kind: 'generate', dir: UI_DIR, outputs: UI_OUTPUTS },
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
    refs: [refFile('outputs/design/ui/figma/figma.json', L.figmaConfig, { locked: true, humanLabel: HL.figmaConfig })],
    context: [ctxDir(SOURCES_DIR, L.sources, { createIntent: 'gen-plan', humanLabel: HL.prd }), ctxDir(ASSETS_DIR, L.assets, { humanLabel: HL.assets })],
    target: { kind: 'generate', dir: GAME_ART_DIR, outputs: GAME_ART_OUTPUTS },
    basis: { tiers: GAME_ART_TIERS, defaults: { game: GAME_FE_PHASER } },
  },
  'gen-game-art-desc': {
    refs: [refDir(SOURCES_DIR, L.sources, { createIntent: 'gen-plan', humanLabel: HL.prd })],
    context: [ctxDir(ASSETS_DIR, L.assets, { humanLabel: HL.assets })],
    target: { kind: 'generate', dir: GAME_ART_DIR, outputs: GAME_ART_OUTPUTS },
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
    refs: [refDir(SOURCES_DIR, L.sources, { createIntent: 'gen-plan', humanLabel: HL.prd })],
    context: [
      ctxDir(SYS_DIR, L.systemDesign, { createIntent: 'gen-sys-full', humanLabel: HL.systemDesign }),
      uiSourceCtx({ createIntent: 'gen-ui-desc' }),
    ],
    target: { kind: 'generate', dir: SPEC_DIR, outputs: SPEC_OUTPUTS },
    chatRequiresRefs: false,
    basis: { tiers: PLAN_TIERS },
  },
  'rev-spec': {
    refs: [refDir(SPEC_DIR, L.specDocs, { createIntent: 'gen-spec', humanLabel: HL.specDocs })],
    context: [
      ctxDir(SYS_DIR, L.systemDesign, { createIntent: 'gen-sys-full', humanLabel: HL.systemDesign }),
      ctxDir(SOURCES_DIR, L.sources, { createIntent: 'gen-plan', humanLabel: HL.prd }),
    ],
    target: { kind: 'revise' },
    buildDisabled: true,
    refsSingleSelect: true,
    basis: { tiers: [] },
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
    context: [ctxDir(SOURCES_DIR, L.sources, { createIntent: 'gen-plan', humanLabel: HL.prd })],
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
    ],
    target: { kind: 'codebase' },
    buildDisabled: true,
    basis: { tiers: CODE_TIERS, defaults: { game: GAME_FE_PHASER } },
  },

  // ── Code: Rev (codebase required; spec docs as opt-in ref, design docs as context) ──
  'rev-code': {
    refs: [codebaseRef(), refDir(SPEC_DIR, L.specDocs, { required: false, createIntent: 'gen-spec', humanLabel: HL.specDocs })],
    context: [
      ctxDir(SYS_DIR, L.systemDesign, { createIntent: 'gen-sys-full', humanLabel: HL.systemDesign }),
      uiSourceCtx({ createIntent: 'gen-ui-desc' }),
      gameArtSourceCtx(),
    ],
    target: { kind: 'codebase' },
    basis: { tiers: [] },
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
    refs: [codebaseRef()],
    context: [],
    target: { kind: 'codebase' },
  },

  // ── Explain (cross-domain) ────────────────
  'explain-code': {
    refs: [codebaseRef()],
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
 * Get the refs/context/target configuration for a given intent.
 * Returns null if the intent is not defined in the matrix.
 *
 * Note — the returned `ConfigSlots` is the FULL definition (all slots).
 * Use `filterSlotsByDomain` to drop slots whose `applicableDomains` does
 * not include the active workspace domain (D28).
 */
export function getConfigSlots(intent: IntentId): ConfigSlots | null {
  return MATRIX[intent] ?? null;
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
 * Check if a filename matches an OutputSpec pattern.
 * Used by UI to show conflict warnings on gen intents.
 */
export function matchesOutputSpec(filename: string, spec: OutputSpec): boolean {
  return filename.startsWith(spec.prefix) && filename.endsWith(spec.ext);
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

/**
 * Whether locked codebase ref coexists with non-codebase ref slots.
 * When true, build requires user-selected (non-codebase) refs — locked codebase alone is insufficient.
 * Currently applies to rev-code (codebase + optional spec docs).
 */
export function hasMixedCodebaseRefs(slots: ConfigSlots): boolean {
  const hasLockedCodebase = slots.refs.some(r => r.codebase && r.locked);
  const hasNonCodebase = slots.refs.some(r => !r.codebase && !r.emptyHint && r.path);
  return hasLockedCodebase && hasNonCodebase;
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

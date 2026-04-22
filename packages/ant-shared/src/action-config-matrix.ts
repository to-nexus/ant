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

export interface BasisSlotConfig {
  techTier?: boolean;
  visualTier?: boolean;
  defaults?: { stack?: 'frontend' | 'backend' | 'fullstack' };
}

/**
 * Runtime gate for Visual Tier availability.
 *
 * Visual Tier is conceptually a policy for UI-producing artifacts.
 * BasisSlotConfig.visualTier = true declares "possible", not "always required".
 * For stack === 'backend' artifacts, visual tier is meaningless and must be
 * suppressed across every surface (wizard tab, summary row, decompose merge,
 * prompt injection). All four surfaces read this single predicate.
 */
export function isVisualTierActive(
  basisSlot: BasisSlotConfig | undefined,
  techTier: import('./rac').TechTierConfig | undefined,
): boolean {
  if (!basisSlot?.visualTier) return false;
  return techTier?.stack !== 'backend';
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

export interface SlotDef {
  path: string;
  label: { en: string; ko: string };
  /** 'dir' = expand to list files inside; 'file' = single file entry */
  type: 'dir' | 'file';
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
  references: { en: 'Reference Images', ko: '레퍼런스 이미지' },
  assets: { en: 'Assets', ko: '에셋' },
  feSystem: { en: 'fe-system-*.md', ko: 'fe-system-*.md' },
  beSystem: { en: 'be-system-*.md', ko: 'be-system-*.md' },
  apiContract: { en: 'api-contract-*.md', ko: 'api-contract-*.md' },
  uiTokens: { en: 'ui-tokens.json', ko: 'ui-tokens.json' },
  uiAssets: { en: 'ui-assets.json', ko: 'ui-assets.json' },
  uiSpec: { en: 'ui-spec.json', ko: 'ui-spec.json' },
  spec: { en: 'spec-*.md', ko: 'spec-*.md' },
  plan: { en: 'PRD', ko: '기획서' },
  prd: { en: 'prd.md', ko: 'prd.md' },
  visual: { en: 'Generated Images', ko: '생성 이미지' },
} as const;

const HL = {
  prd: { en: 'PRD / Requirements', ko: '기획서' },
  systemDesign: { en: 'System Design Documents', ko: '시스템 설계 문서' },
  uiDesign: { en: 'UI Design Documents', ko: 'UI 설계 문서' },
  specDocs: { en: 'Feature Spec Documents', ko: '기능 스펙 문서' },
  designAll: { en: 'Design Documents', ko: '설계 문서' },
  figmaConfig: { en: 'Figma Configuration', ko: 'Figma 설정 파일' },
  references: { en: 'Reference Images', ko: '레퍼런스 이미지' },
  assets: { en: 'Asset Files', ko: '에셋 파일' },
  visual: { en: 'Generated Images', ko: '생성 이미지' },
} as const;

// ============================================
// Matrix Data
// ============================================

const SYS_DIR = 'outputs/design/system';
const UI_DIR = 'outputs/design/ui';
const SPEC_DIR = 'outputs/design/spec';
const DESIGN_DIR = 'outputs/design';
const SOURCES_DIR = 'inputs/sources';
const REFS_DIR = 'inputs/references';
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
const SPEC_OUTPUTS: OutputSpec[] = [output('spec-', '.md', L.spec)];

import type { IntentId } from './actions';

const MATRIX: Record<IntentId, ConfigSlots> = {
  // ── Plan ──────────────────────────────────
  'gen-plan': {
    refs: [refDir(SOURCES_DIR, L.sources, { required: false, humanLabel: HL.prd, excludeFiles: ['prd.md'] })],
    context: [],
    target: { kind: 'generate', dir: SOURCES_DIR, outputs: [output('prd', '.md', L.prd, false)] },
    chatRequiresRefs: false,
  },
  'rev-plan': {
    refs: [refDir(SOURCES_DIR, L.sources, { createIntent: 'gen-plan', humanLabel: HL.prd })],
    context: [ctxDir(SOURCES_DIR, L.sources, { excludeSelectedRefs: true })],
    target: { kind: 'revise' },
    buildDisabled: true,
    refsSingleSelect: true,
  },

  // ── System Design: Gen ─────────────────────
  'gen-sys-fe': {
    refs: [refDir(SOURCES_DIR, L.sources, { createIntent: 'gen-plan', humanLabel: HL.prd })],
    context: [ctxDir(SYS_DIR, L.systemDesign, { humanLabel: HL.systemDesign })],
    target: { kind: 'generate', dir: SYS_DIR, outputs: FE_OUTPUTS },
    basis: { techTier: true, defaults: { stack: 'frontend' } },
  },
  'gen-sys-be': {
    refs: [refDir(SOURCES_DIR, L.sources, { createIntent: 'gen-plan', humanLabel: HL.prd })],
    context: [ctxDir(SYS_DIR, L.systemDesign, { humanLabel: HL.systemDesign })],
    target: { kind: 'generate', dir: SYS_DIR, outputs: BE_OUTPUTS },
    basis: { techTier: true, defaults: { stack: 'backend' } },
  },
  'gen-sys-full': {
    refs: [refDir(SOURCES_DIR, L.sources, { createIntent: 'gen-plan', humanLabel: HL.prd })],
    context: [ctxDir(SYS_DIR, L.systemDesign, { humanLabel: HL.systemDesign })],
    target: { kind: 'generate', dir: SYS_DIR, outputs: FULLSTACK_OUTPUTS },
    basis: { techTier: true, defaults: { stack: 'fullstack' } },
  },

  // ── System Design: Rev ─────────────────────
  'rev-sys': {
    refs: [refDir(SYS_DIR, L.systemDesign, { createIntent: 'gen-sys-full', humanLabel: HL.systemDesign })],
    context: [ctxDir(SOURCES_DIR, L.sources, { createIntent: 'gen-plan', humanLabel: HL.prd })],
    target: { kind: 'revise' },
    buildDisabled: true,
    refsSingleSelect: true,
  },

  // ── UI Design: Gen ─────────────────────────
  'gen-ui-figma': {
    refs: [refFile('inputs/figma.json', L.figmaConfig, { locked: true, humanLabel: HL.figmaConfig })],
    context: [ctxDir(SOURCES_DIR, L.sources, { createIntent: 'gen-plan', humanLabel: HL.prd })],
    target: { kind: 'generate', dir: UI_DIR, outputs: UI_OUTPUTS },
  },
  'gen-ui-ref': {
    refs: [refDir(REFS_DIR, L.references, { humanLabel: HL.references })],
    context: [ctxDir(SOURCES_DIR, L.sources, { createIntent: 'gen-plan', humanLabel: HL.prd }), ctxDir(ASSETS_DIR, L.assets, { humanLabel: HL.assets })],
    target: { kind: 'generate', dir: UI_DIR, outputs: UI_OUTPUTS },
    basis: { visualTier: true },
  },
  'gen-ui-desc': {
    refs: [refDir(SOURCES_DIR, L.sources, { createIntent: 'gen-plan', humanLabel: HL.prd })],
    context: [],
    target: { kind: 'generate', dir: UI_DIR, outputs: UI_OUTPUTS },
    chatRequiresRefs: false,
    basis: { visualTier: true },
  },

  // ── UI Design: Rev ─────────────────────────
  'rev-ui': {
    refs: [refDir(UI_DIR, L.uiDesign, { createIntent: 'gen-ui-desc', humanLabel: HL.uiDesign })],
    context: [ctxDir(SOURCES_DIR, L.sources, { createIntent: 'gen-plan', humanLabel: HL.prd })],
    target: { kind: 'revise' },
    buildDisabled: true,
    refsSingleSelect: true,
    basis: { visualTier: true },
  },

  // ── Spec ──────────────────────────────────
  'gen-spec': {
    refs: [refDir(SOURCES_DIR, L.sources, { createIntent: 'gen-plan', humanLabel: HL.prd })],
    context: [
      ctxDir(SYS_DIR, L.systemDesign, { createIntent: 'gen-sys-full', humanLabel: HL.systemDesign }),
      ctxDir(UI_DIR, L.uiDesign, { createIntent: 'gen-ui-desc', humanLabel: HL.uiDesign }),
    ],
    target: { kind: 'generate', dir: SPEC_DIR, outputs: SPEC_OUTPUTS },
    chatRequiresRefs: false,
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
  },

  // ── Code: Gen (3 pipeline-specific intents) ──
  'gen-code-sys': {
    refs: [refDir(SYS_DIR, L.systemDesign, { createIntent: 'gen-sys-full', humanLabel: HL.systemDesign }), refDir(UI_DIR, L.uiDesign, { createIntent: 'gen-ui-desc', humanLabel: HL.uiDesign })],
    context: [ctxDir(SOURCES_DIR, L.sources, { createIntent: 'gen-plan', humanLabel: HL.prd })],
    target: { kind: 'codebase' },
    basis: { techTier: true, visualTier: true },
  },
  'gen-code-spec': {
    refs: [refDir(SPEC_DIR, L.specDocs, { createIntent: 'gen-spec', humanLabel: HL.specDocs })],
    context: [ctxDir(SYS_DIR, L.systemDesign, { createIntent: 'gen-sys-full', humanLabel: HL.systemDesign }), ctxDir(UI_DIR, L.uiDesign, { createIntent: 'gen-ui-desc', humanLabel: HL.uiDesign }), ctxDir(SOURCES_DIR, L.sources, { createIntent: 'gen-plan', humanLabel: HL.prd })],
    target: { kind: 'codebase' },
    refsSingleSelect: true,
    basis: { techTier: true, visualTier: true },
  },
  'gen-code-directive': {
    refs: [emptyRef()],
    context: [ctxDir(SOURCES_DIR, L.sources, { createIntent: 'gen-plan', humanLabel: HL.prd })],
    target: { kind: 'codebase' },
    buildDisabled: true,
    basis: { techTier: true, visualTier: true },
  },

  // ── Code: Rev (codebase required; spec docs as opt-in ref, design docs as context) ──
  'rev-code': {
    refs: [codebaseRef(), refDir(SPEC_DIR, L.specDocs, { required: false, createIntent: 'gen-spec', humanLabel: HL.specDocs })],
    context: [ctxDir(SYS_DIR, L.systemDesign, { createIntent: 'gen-sys-full', humanLabel: HL.systemDesign }), ctxDir(UI_DIR, L.uiDesign, { createIntent: 'gen-ui-desc', humanLabel: HL.uiDesign })],
    target: { kind: 'codebase' },
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
    refs: [refDir(UI_DIR, L.uiDesign, { humanLabel: HL.uiDesign })],
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
 */
export function getConfigSlots(intent: IntentId): ConfigSlots | null {
  return MATRIX[intent] ?? null;
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

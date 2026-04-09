/**
 * Action Config Matrix
 *
 * Defines (intent, basis) → (refs, context, target) mapping.
 * Single source of truth consumed by both FE (ActionConfigView) and
 * BE (resolve node) to determine which files to show/load.
 *
 * Rules:
 * - Refs (primary): default ON, individually toggleable. locked=true → cannot deselect.
 * - Context (secondary): default OFF, individually toggleable.
 * - Target: create intents show expected file patterns with warnIfExists.
 *           revise intents use mirrorRefs (target = selected refs).
 * - buildRequiresContext: when true, BUILD needs at least one context file.
 *   Chat start is always allowed if refs are satisfied.
 */

import type { Basis } from './actions';

// ============================================
// Types
// ============================================

export interface ConfigSlots {
  refs: SlotDef[];
  context: SlotDef[];
  target: TargetDef;
  /** When true, BUILD requires at least one context file to be present */
  buildRequiresContext?: boolean;
}

export interface SlotDef {
  path: string;
  label: { en: string; ko: string };
  /** 'dir' = expand to list files inside; 'file' = single file entry */
  type: 'dir' | 'file';
  defaultSelected: boolean;
  /** When true, user cannot deselect (revise: ref = target file) */
  locked?: boolean;
  /** Shown when slot resolves to zero files */
  emptyHint?: { en: string; ko: string };
  /** When true, files already selected as refs are excluded from this slot's listing */
  excludeSelectedRefs?: boolean;
}

export interface TargetDef {
  /** Directory for target files */
  dir?: string;
  /** Expected output file patterns (create intents) */
  expectedFiles?: ExpectedFile[];
  /** Special marker: target is the codebase, not feature-relative */
  codebase?: boolean;
  /** When true, target = selectedRefs (revise: the files being revised ARE the output) */
  mirrorRefs?: boolean;
}

export interface ExpectedFile {
  /** Filename prefix (fe-system-, be-system-, api-contract-, ui-tokens, etc.) */
  prefix: string;
  ext: string;
  label: { en: string; ko: string };
  warnIfExists: boolean;
}

// ============================================
// Helpers
// ============================================

const CHAT_HINT = { en: 'Provide instructions via chat', ko: '채팅에 직접 입력합니다' };

function refDir(path: string, label: { en: string; ko: string }, opts?: { locked?: boolean }): SlotDef {
  return { path, label, type: 'dir', defaultSelected: true, locked: opts?.locked };
}

function refFile(path: string, label: { en: string; ko: string }, opts?: { locked?: boolean }): SlotDef {
  return { path, label, type: 'file', defaultSelected: true, locked: opts?.locked };
}

function ctxDir(path: string, label: { en: string; ko: string }, opts?: { excludeSelectedRefs?: boolean }): SlotDef {
  return { path, label, type: 'dir', defaultSelected: false, excludeSelectedRefs: opts?.excludeSelectedRefs };
}

function emptyRef(): SlotDef {
  return { path: '', label: CHAT_HINT, type: 'file', defaultSelected: false, emptyHint: CHAT_HINT };
}

function expected(prefix: string, ext: string, label: { en: string; ko: string }): ExpectedFile {
  return { prefix, ext, label, warnIfExists: true };
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

// ============================================
// Matrix Data
// ============================================

const SYS_DIR = 'outputs/design/system';
const UI_DIR = 'outputs/design/ui';
const SPEC_DIR = 'outputs/design/spec';
const DESIGN_DIR = 'outputs/design';
const PLAN_DIR = 'outputs/plan';
const SOURCES_DIR = 'inputs/sources';
const REFS_DIR = 'inputs/references';
const ASSETS_DIR = 'inputs/assets';
const ASSETS_GEN_DIR = 'inputs/assets/gen';

const FE_TARGETS: ExpectedFile[] = [expected('fe-system-', '.md', L.feSystem)];
const BE_TARGETS: ExpectedFile[] = [expected('be-system-', '.md', L.beSystem), expected('api-contract-', '.md', L.apiContract)];
const FULLSTACK_TARGETS: ExpectedFile[] = [...FE_TARGETS, ...BE_TARGETS];
const UI_TARGETS: ExpectedFile[] = [
  expected('ui-tokens', '.json', L.uiTokens),
  expected('ui-assets', '.json', L.uiAssets),
  expected('ui-spec', '.json', L.uiSpec),
];
const SPEC_TARGETS: ExpectedFile[] = [expected('spec-', '.md', L.spec)];

type MatrixEntry = Partial<Record<Basis, ConfigSlots>>;

const MATRIX: Record<string, MatrixEntry> = {
  // ── Plan ──────────────────────────────────
  'create-plan': {
    directive: {
      refs: [emptyRef()],
      context: [ctxDir(SOURCES_DIR, L.sources)],
      target: { dir: PLAN_DIR, expectedFiles: [expected('prd', '.md', L.prd)] },
    },
  },
  'revise-plan': {
    directive: {
      refs: [refDir(SOURCES_DIR, L.sources)],
      context: [ctxDir(SOURCES_DIR, L.sources, { excludeSelectedRefs: true })],
      target: { mirrorRefs: true },
      buildRequiresContext: true,
    },
  },

  // ── System Design: Create ─────────────────
  'create-fe': {
    prd: {
      refs: [refDir(SOURCES_DIR, L.sources)],
      context: [ctxDir(SYS_DIR, L.systemDesign)],
      target: { dir: SYS_DIR, expectedFiles: FE_TARGETS },
    },
    directive: {
      refs: [emptyRef()],
      context: [ctxDir(SYS_DIR, L.systemDesign)],
      target: { dir: SYS_DIR, expectedFiles: FE_TARGETS },
    },
  },
  'create-be': {
    prd: {
      refs: [refDir(SOURCES_DIR, L.sources)],
      context: [ctxDir(SYS_DIR, L.systemDesign)],
      target: { dir: SYS_DIR, expectedFiles: BE_TARGETS },
    },
    directive: {
      refs: [emptyRef()],
      context: [ctxDir(SYS_DIR, L.systemDesign)],
      target: { dir: SYS_DIR, expectedFiles: BE_TARGETS },
    },
  },
  'create-fullstack': {
    prd: {
      refs: [refDir(SOURCES_DIR, L.sources)],
      context: [ctxDir(SYS_DIR, L.systemDesign)],
      target: { dir: SYS_DIR, expectedFiles: FULLSTACK_TARGETS },
    },
    directive: {
      refs: [emptyRef()],
      context: [ctxDir(SYS_DIR, L.systemDesign)],
      target: { dir: SYS_DIR, expectedFiles: FULLSTACK_TARGETS },
    },
  },

  // ── System Design: Revise ─────────────────
  'revise-system': {
    directive: {
      refs: [refDir(SYS_DIR, L.systemDesign)],
      context: [ctxDir(SOURCES_DIR, L.sources)],
      target: { mirrorRefs: true },
      buildRequiresContext: true,
    },
  },

  // ── UI Design: Create ─────────────────────
  'create-figma': {
    figma: {
      refs: [refFile('inputs/figma.json', L.figmaConfig, { locked: true })],
      context: [ctxDir(SOURCES_DIR, L.sources)],
      target: { dir: UI_DIR, expectedFiles: UI_TARGETS },
    },
  },
  'create-ref': {
    references: {
      refs: [refDir(REFS_DIR, L.references)],
      context: [ctxDir(SOURCES_DIR, L.sources), ctxDir(ASSETS_DIR, L.assets)],
      target: { dir: UI_DIR, expectedFiles: UI_TARGETS },
    },
  },
  'create-desc': {
    directive: {
      refs: [emptyRef()],
      context: [ctxDir(SOURCES_DIR, L.sources)],
      target: { dir: UI_DIR, expectedFiles: UI_TARGETS },
    },
  },

  // ── UI Design: Revise ─────────────────────
  'revise-ui': {
    directive: {
      refs: [refDir(UI_DIR, L.uiDesign)],
      context: [ctxDir(SOURCES_DIR, L.sources)],
      target: { mirrorRefs: true },
      buildRequiresContext: true,
    },
  },

  // ── Spec ──────────────────────────────────
  'create-spec': {
    'existing-doc': {
      refs: [refDir(DESIGN_DIR, L.designAll)],
      context: [],
      target: { dir: SPEC_DIR, expectedFiles: SPEC_TARGETS },
    },
    directive: {
      refs: [emptyRef()],
      context: [ctxDir(DESIGN_DIR, L.designAll)],
      target: { dir: SPEC_DIR, expectedFiles: SPEC_TARGETS },
    },
  },
  'revise-spec': {
    directive: {
      refs: [refDir(SPEC_DIR, L.specDocs)],
      context: [ctxDir(DESIGN_DIR, L.designAll)],
      target: { mirrorRefs: true },
      buildRequiresContext: true,
    },
  },

  // ── Code ──────────────────────────────────
  'create-code': {
    spec: {
      refs: [refDir(SPEC_DIR, L.specDocs)],
      context: [ctxDir(SYS_DIR, L.systemDesign), ctxDir(UI_DIR, L.uiDesign)],
      target: { codebase: true },
    },
    'design-doc': {
      refs: [refDir(SYS_DIR, L.systemDesign), refDir(UI_DIR, L.uiDesign)],
      context: [],
      target: { codebase: true },
    },
    directive: {
      refs: [emptyRef()],
      context: [],
      target: { codebase: true },
    },
  },
  'refactor-code': {
    'existing-doc': {
      refs: [refDir(SPEC_DIR, L.specDocs), refDir(SYS_DIR, L.systemDesign), refDir(UI_DIR, L.uiDesign)],
      context: [],
      target: { codebase: true },
    },
    directive: {
      refs: [emptyRef()],
      context: [],
      target: { codebase: true },
    },
  },

  // ── Visual ────────────────────────────────
  'create-visual': {
    directive: {
      refs: [emptyRef()],
      context: [],
      target: { dir: ASSETS_GEN_DIR },
    },
  },

  // ── Learn ─────────────────────────────────
  'create-learn': {
    directive: {
      refs: [emptyRef()],
      context: [],
      target: { codebase: true },
    },
  },
};

// ============================================
// Public API
// ============================================

/**
 * Get the refs/context/target configuration for a given (intent, basis) combination.
 * Returns null if the combination is not defined in the matrix.
 */
export function getConfigSlots(intent: string, basis: Basis): ConfigSlots | null {
  const entry = MATRIX[intent];
  if (!entry) return null;
  return entry[basis] ?? null;
}

/**
 * Get all valid basis options for a given intent.
 */
export function getAvailableBases(intent: string): Basis[] {
  const entry = MATRIX[intent];
  if (!entry) return [];
  return Object.keys(entry) as Basis[];
}

/**
 * Check if an expected target file pattern already has matching files.
 * Used by UI to show conflict warnings on create intents.
 */
export function matchesExpectedFile(filename: string, expected: ExpectedFile): boolean {
  return filename.startsWith(expected.prefix) && filename.endsWith(expected.ext);
}

/**
 * Actions System Types & Definitions
 *
 * Shared between BE (Readiness API) and FE (ActionsPanel).
 * Single source of truth for action definitions, material rules, and file naming validation.
 */

import type { JobType } from './job';
import type { DesignSubdir } from './canonical';
import type { IntentGroup } from './detection';

// ============================================
// Action Definitions
// ============================================

/** @deprecated Use IntentGroup instead */
export type ActionId = IntentGroup;

export type ActionStatus = 'active' | 'coming-soon';

/**
 * An Action is an intent group — the top-level card in ActionsPanel.
 * Each Action groups one or more Intents that share a domain.
 * The actual agent, jobType, and pipeline config are determined
 * per-Intent via deriveFromIntent() and the config matrix.
 */
export interface ActionDefinition {
  readonly id: IntentGroup;
  readonly label: { en: string; ko: string };
  readonly description: { en: string; ko: string };
  readonly status: ActionStatus;
  /**
   * Whether this action belongs to a specific agent's workflow.
   * `false` = cross-cutting action (e.g. ask) — only shown in unfiltered "all actions" view,
   * hidden in per-agent filtered views.
   * Defaults to `true` when omitted.
   */
  readonly agentScoped?: boolean;
}

export const ACTION_DEFINITIONS: ReadonlyArray<ActionDefinition> = [
  {
    id: 'plan',
    label: { en: 'PRD', ko: '기획서' },
    description: { en: 'Create or revise product requirements', ko: '기획서를 작성하거나 보강합니다' },
    status: 'active',
  },
  {
    id: 'design-system',
    label: { en: 'System Design', ko: '시스템 설계' },
    description: { en: 'Design architecture, API contracts, and data models', ko: '아키텍처, API 계약, 데이터 모델을 설계합니다' },
    status: 'active',
  },
  {
    id: 'design-ui',
    label: { en: 'UI Design', ko: 'UI 설계' },
    description: { en: 'Design tokens, assets, and UI specifications', ko: '디자인 토큰, 에셋, UI 스펙을 설계합니다' },
    status: 'active',
  },
  {
    id: 'design-spec',
    label: { en: 'Feature Spec', ko: '기능 스펙' },
    description: { en: 'Create implementation specs for a feature scope', ko: '특정 기능의 구현 계획을 작성합니다' },
    status: 'active',
  },
  {
    id: 'code',
    label: { en: 'Code', ko: '코드' },
    description: { en: 'Generate or refactor code', ko: '코드를 생성하거나 리팩토링합니다' },
    status: 'active',
  },
  {
    id: 'visual',
    label: { en: 'Visual', ko: '이미지' },
    description: { en: 'Generate images, icons, and visual assets', ko: '이미지, 아이콘, 비주얼 에셋을 생성합니다' },
    status: 'active',
  },
  {
    id: 'learn-codebase',
    label: { en: 'Learn Codebase', ko: '코드베이스 학습' },
    description: { en: 'Analyze and index existing codebase', ko: '기존 코드를 분석하고 인덱싱합니다' },
    status: 'coming-soon',
  },
  {
    id: 'ask',
    label: { en: 'Ask', ko: '질문' },
    description: { en: 'Ask questions and get evaluations', ko: '질문하고 평가를 받습니다' },
    status: 'active',
    agentScoped: false,
  },
];

// ============================================
// Detected execution modes (auto-detected, not user-selected)
// ============================================

export type DesignExecutionMode = 'generate' | 'refactor';

// ============================================
// Intent Definitions (first-class concept)
// ============================================

export interface IntentDefinitionShape {
  readonly id: string;
  readonly intentGroup: IntentGroup;
  readonly label: { en: string; ko: string };
  readonly description: { en: string; ko: string };
}

const INTENT_DEFINITIONS_INTERNAL = [
  // Plan
  { id: 'gen-plan', intentGroup: 'plan', label: { en: 'Create PRD', ko: '기획서 작성' }, description: { en: 'Generate a new product requirements document', ko: '새 기획서를 작성합니다' } },
  { id: 'rev-plan', intentGroup: 'plan', label: { en: 'Update PRD', ko: '기획서 업데이트' }, description: { en: 'Revise existing PRD document', ko: '기존 기획서를 업데이트합니다' } },
  { id: 'explain-plan', intentGroup: 'plan', label: { en: 'Explain PRD', ko: '기획서 설명' }, description: { en: 'Explain PRD content and requirements', ko: '기획서 내용과 요구사항을 설명합니다' } },

  // Design — System
  { id: 'gen-sys-fe', intentGroup: 'design-system', label: { en: 'Frontend System', ko: '프론트엔드 시스템' }, description: { en: 'Design frontend architecture', ko: '프론트엔드 아키텍처를 설계합니다' } },
  { id: 'gen-sys-be', intentGroup: 'design-system', label: { en: 'Backend System', ko: '백엔드 시스템' }, description: { en: 'Design backend architecture and API contracts', ko: '백엔드 아키텍처와 API 계약을 설계합니다' } },
  { id: 'gen-sys-full', intentGroup: 'design-system', label: { en: 'Fullstack System', ko: '풀스택 시스템' }, description: { en: 'Design full-stack architecture', ko: '풀스택 아키텍처를 설계합니다' } },
  { id: 'rev-sys', intentGroup: 'design-system', label: { en: 'Update Design', ko: '설계 업데이트' }, description: { en: 'Revise existing system design documents', ko: '기존 시스템 설계 문서를 업데이트합니다' } },
  { id: 'explain-sys', intentGroup: 'design-system', label: { en: 'Explain System Design', ko: '시스템 설계 설명' }, description: { en: 'Explain system architecture and design', ko: '시스템 아키텍처와 설계를 설명합니다' } },

  // Design — UI
  { id: 'gen-ui-figma', intentGroup: 'design-ui', label: { en: 'Figma-based', ko: 'Figma 기반' }, description: { en: 'Extract design from Figma file', ko: 'Figma 파일에서 디자인을 추출합니다' } },
  { id: 'gen-ui-ref', intentGroup: 'design-ui', label: { en: 'Screenshot-based', ko: '스크린샷 기반' }, description: { en: 'Design UI from reference images', ko: '레퍼런스 이미지로 UI를 설계합니다' } },
  { id: 'gen-ui-desc', intentGroup: 'design-ui', label: { en: 'Description-based', ko: '설명 기반' }, description: { en: 'Design UI from text description', ko: '텍스트 설명으로 UI를 설계합니다' } },
  { id: 'rev-ui', intentGroup: 'design-ui', label: { en: 'Update UI Design', ko: 'UI 설계 업데이트' }, description: { en: 'Revise existing UI design documents', ko: '기존 UI 설계 문서를 업데이트합니다' } },
  { id: 'explain-ui', intentGroup: 'design-ui', label: { en: 'Explain UI Design', ko: 'UI 설계 설명' }, description: { en: 'Explain UI design decisions and specs', ko: 'UI 설계 결정과 스펙을 설명합니다' } },

  // Design — Spec
  { id: 'gen-spec', intentGroup: 'design-spec', label: { en: 'Create Spec', ko: '스펙 작성' }, description: { en: 'Write implementation spec for a feature', ko: '기능의 구현 스펙을 작성합니다' } },
  { id: 'rev-spec', intentGroup: 'design-spec', label: { en: 'Update Spec', ko: '스펙 업데이트' }, description: { en: 'Revise existing spec document', ko: '기존 스펙 문서를 업데이트합니다' } },
  { id: 'explain-spec', intentGroup: 'design-spec', label: { en: 'Explain Spec', ko: '스펙 설명' }, description: { en: 'Explain feature specification details', ko: '기능 스펙 상세를 설명합니다' } },

  // Code
  { id: 'gen-code-sys', intentGroup: 'code', label: { en: 'Code from System Design', ko: '시스템 설계 기반 코드' }, description: { en: 'Generate code from system design documents', ko: '시스템 설계 문서를 기반으로 코드를 생성합니다' } },
  { id: 'gen-code-spec', intentGroup: 'code', label: { en: 'Code from Spec', ko: '스펙 기반 코드' }, description: { en: 'Generate code from feature spec documents', ko: '기능 스펙 문서를 기반으로 코드를 생성합니다' } },
  { id: 'gen-code-directive', intentGroup: 'code', label: { en: 'Code from Directive', ko: '지시사항 기반 코드' }, description: { en: 'Generate code from chat directive', ko: '채팅 지시사항으로 코드를 생성합니다' } },
  { id: 'rev-code', intentGroup: 'code', label: { en: 'Refactor Code', ko: '코드 리팩토링' }, description: { en: 'Refactor existing codebase', ko: '기존 코드를 리팩토링합니다' } },
  { id: 'explain-code', intentGroup: 'code', label: { en: 'Explain Code', ko: '코드 설명' }, description: { en: 'Explain and answer questions about code', ko: '코드에 대해 설명하고 질문에 답합니다' } },

  // Visual
  { id: 'gen-visual-logo', intentGroup: 'visual', label: { en: 'Logo', ko: '로고' }, description: { en: 'Generate brand marks, symbols, and monograms', ko: '브랜드 마크, 심볼, 모노그램을 생성합니다' } },
  { id: 'gen-visual-icon', intentGroup: 'visual', label: { en: 'Icon', ko: '아이콘' }, description: { en: 'Generate UI icons, action icons, and status indicators', ko: 'UI 아이콘, 액션 아이콘, 상태 표시기를 생성합니다' } },
  { id: 'gen-visual-hero', intentGroup: 'visual', label: { en: 'Hero Image', ko: '히어로 이미지' }, description: { en: 'Generate hero images, banners, and cover art', ko: '히어로 이미지, 배너, 커버 아트를 생성합니다' } },
  { id: 'gen-visual-illustration', intentGroup: 'visual', label: { en: 'Illustration', ko: '일러스트' }, description: { en: 'Generate illustrations, diagrams, and decorative art', ko: '일러스트, 다이어그램, 장식 아트를 생성합니다' } },
  { id: 'explain-visual', intentGroup: 'visual', label: { en: 'Explain Visual', ko: '이미지 설명' }, description: { en: 'Explain visual assets and images', ko: '이미지와 비주얼 에셋을 설명합니다' } },

  // Learn
  { id: 'gen-learn', intentGroup: 'learn-codebase', label: { en: 'Learn Codebase', ko: '코드베이스 학습' }, description: { en: 'Analyze and index codebase', ko: '코드를 분석하고 인덱싱합니다' } },

  // Ask
  { id: 'ask-evaluate', intentGroup: 'ask', label: { en: 'Evaluate', ko: '평가' }, description: { en: 'Evaluate artifacts against rubrics', ko: '산출물을 루브릭에 따라 평가합니다' } },
  { id: 'ask-ant', intentGroup: 'ask', label: { en: 'Ask Ant', ko: 'Ant 질문' }, description: { en: 'Ask questions about Ant system', ko: 'Ant 시스템에 대해 질문합니다' } },
  { id: 'ask-general', intentGroup: 'ask', label: { en: 'General Question', ko: '일반 질문' }, description: { en: 'Ask general questions about the project', ko: '프로젝트에 대한 일반적인 질문을 합니다' } },
] as const satisfies ReadonlyArray<IntentDefinitionShape>;

/** Union of all valid intent ID strings, derived from INTENT_DEFINITIONS. */
export type IntentId = typeof INTENT_DEFINITIONS_INTERNAL[number]['id'];

/** Runtime intent definition with literal id type. */
export type IntentDefinition = typeof INTENT_DEFINITIONS_INTERNAL[number];

export const INTENT_DEFINITIONS: ReadonlyArray<IntentDefinition> = INTENT_DEFINITIONS_INTERNAL;

/** Get intents available for a given intent group */
export function getIntentsForAction(group: IntentGroup): ReadonlyArray<IntentDefinition> {
  return INTENT_DEFINITIONS.filter(d => d.intentGroup === group);
}

/** Type guard: check if a string is a valid IntentId from INTENT_DEFINITIONS. */
export function isValidIntentId(id: string): id is IntentId {
  return INTENT_DEFINITIONS.some(d => d.id === id);
}

// ============================================
// ActionMetadata (passed from FE to BE for explicit/infer pipeline)
// ============================================

export interface ActionMetadata {
  /** true = explicit pipeline (no inference, use only provided values). Set only via ActionsPanel "Start via Chat". */
  explicit?: boolean;
  /** When present, determines agent/job and bypasses triage */
  intent?: IntentId;
  /** Target output file paths */
  target?: string[];
  /** Primary reference file paths */
  refs?: string[];
  /** Secondary context file paths */
  context?: string[];
  /** User's UI locale (e.g. 'ko', 'en'). Overrides auto-detection when present. Not displayed in UI badges. */
  locale?: string;
  /** @deprecated Use locale */
  language?: string;
}

/**
 * Derive intentGroup, mode, and routing info from an intent string.
 * Used by resolveToRAC() to derive mode/intentGroup from intentId.
 * environment is NOT returned — target tier uses intentId→target file mapping,
 * tech tier is decompose's responsibility.
 */
export function deriveFromIntent(intent: IntentId): {
  intentGroup?: IntentGroup;
  mode: 'generate' | 'refactor' | 'explain';
  agent: string;
  jobType: string;
  targetTier?: string;
} {
  switch (intent) {
    case 'gen-plan':
      return { mode: 'generate', agent: 'planner', jobType: 'plan' };
    case 'rev-plan':
      return { mode: 'refactor', agent: 'planner', jobType: 'plan' };
    case 'explain-plan':
      return { mode: 'explain', agent: 'planner', jobType: 'plan' };

    case 'gen-sys-fe':
    case 'gen-sys-be':
    case 'gen-sys-full':
      return { intentGroup: 'design-system', mode: 'generate', agent: 'architect', jobType: 'design' };
    case 'rev-sys':
      return { intentGroup: 'design-system', mode: 'refactor', agent: 'architect', jobType: 'design' };
    case 'explain-sys':
      return { intentGroup: 'design-system', mode: 'explain', agent: 'architect', jobType: 'design' };

    case 'gen-ui-figma':
    case 'gen-ui-ref':
    case 'gen-ui-desc':
      return { intentGroup: 'design-ui', mode: 'generate', agent: 'architect', jobType: 'design' };
    case 'rev-ui':
      return { intentGroup: 'design-ui', mode: 'refactor', agent: 'architect', jobType: 'design' };
    case 'explain-ui':
      return { intentGroup: 'design-ui', mode: 'explain', agent: 'architect', jobType: 'design' };

    case 'gen-spec':
      return { intentGroup: 'design-spec', mode: 'generate', agent: 'architect', jobType: 'design' };
    case 'rev-spec':
      return { intentGroup: 'design-spec', mode: 'refactor', agent: 'architect', jobType: 'design' };
    case 'explain-spec':
      return { intentGroup: 'design-spec', mode: 'explain', agent: 'architect', jobType: 'design' };

    case 'gen-code-sys':
    case 'gen-code-spec':
    case 'gen-code-directive':
      return { mode: 'generate', agent: 'architect', jobType: 'code' };
    case 'rev-code':
      return { mode: 'refactor', agent: 'architect', jobType: 'code' };
    case 'explain-code':
      return { mode: 'explain', agent: 'architect', jobType: 'code' };

    case 'gen-visual-logo':
      return { mode: 'generate', agent: 'creator', jobType: 'visual', targetTier: 'logo' };
    case 'gen-visual-icon':
      return { mode: 'generate', agent: 'creator', jobType: 'visual', targetTier: 'icon' };
    case 'gen-visual-hero':
      return { mode: 'generate', agent: 'creator', jobType: 'visual', targetTier: 'hero' };
    case 'gen-visual-illustration':
      return { mode: 'generate', agent: 'creator', jobType: 'visual', targetTier: 'illustration' };
    case 'explain-visual':
      return { mode: 'explain', agent: 'creator', jobType: 'visual' };

    case 'gen-learn':
      return { mode: 'generate', agent: 'architect', jobType: 'learn' };

    case 'ask-evaluate':
    case 'ask-ant':
    case 'ask-general':
      return { mode: 'explain', agent: 'architect', jobType: 'ask' };

    default:
      return { mode: 'generate', agent: 'architect', jobType: 'design' };
  }
}

// ============================================
// Action Readiness Types (computed on frontend from fileTree + store)
// ============================================

export interface NamingIssue {
  file: string;
  dir: string;
  expectedPattern: string;
  hint: { en: string; ko: string };
}

export interface SubModeStatus {
  id: string;
  active: boolean;
  blockReason?: { en: string; ko: string };
}

export interface ActionReadiness {
  buildReady: boolean;
  buildBlockReason?: { en: string; ko: string };
  hasOutput: boolean;
  hasCodebase: boolean;
  detectedMode: { id: string; label: { en: string; ko: string } };
  subModes?: SubModeStatus[];
  outputDir: string;
  namingIssues: NamingIssue[];
}

// ============================================
// Design File Naming Validation
// ============================================

export interface DesignFilePattern {
  readonly dir: DesignSubdir;
  readonly prefixes: ReadonlyArray<string>;
  readonly ext: string;
  readonly description: { en: string; ko: string };
  readonly wildcardHint: { en: string; ko: string };
}

export const DESIGN_FILE_PATTERNS: ReadonlyArray<DesignFilePattern> = [
  {
    dir: 'system',
    prefixes: ['be-system-', 'fe-system-', 'api-contract-'],
    ext: '.md',
    description: { en: 'System design document', ko: '시스템 설계 문서' },
    wildcardHint: { en: 'service name or "main"', ko: '서비스명 또는 "main"' },
  },
  {
    dir: 'ui',
    prefixes: ['ui-'],
    ext: '.json',
    description: { en: 'UI design document', ko: 'UI 설계 문서' },
    wildcardHint: { en: 'tokens, assets, or spec', ko: 'tokens, assets, 또는 spec' },
  },
  {
    dir: 'spec',
    prefixes: ['spec-'],
    ext: '.md',
    description: { en: 'Feature spec document', ko: '기능 스펙 문서' },
    wildcardHint: { en: 'feature slug (e.g. social-login)', ko: '기능 슬러그 (예: social-login)' },
  },
];

export const FREE_FORM_DIRS = ['inputs/sources', 'inputs/references', 'inputs/assets'] as const;

/**
 * Validate a design output filename against known patterns.
 * Returns valid:true if the file matches its directory's naming convention,
 * or if the directory has no enforced pattern (free-form).
 */
export function validateDesignFileName(
  filename: string,
  dir: DesignSubdir,
): { valid: boolean; expectedPattern?: string; hint?: { en: string; ko: string } } {
  const pattern = DESIGN_FILE_PATTERNS.find(p => p.dir === dir);
  if (!pattern) return { valid: true };

  const matchesPrefix = pattern.prefixes.some(prefix => filename.startsWith(prefix));
  const matchesExt = filename.endsWith(pattern.ext);

  if (matchesPrefix && matchesExt) return { valid: true };

  const examplePatterns = pattern.prefixes.map(p => `${p}*${pattern.ext}`).join(', ');
  return {
    valid: false,
    expectedPattern: examplePatterns,
    hint: pattern.wildcardHint,
  };
}

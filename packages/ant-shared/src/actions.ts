/**
 * Actions System Types & Definitions
 *
 * Shared between BE (Readiness API) and FE (ActionsPanel).
 * Single source of truth for action definitions, material rules, and file naming validation.
 */

import type { JobType } from './job';
import type { DesignSubdir } from './canonical';

// ============================================
// Action Definitions
// ============================================

export type ActionId = 'plan' | 'system-design' | 'ui-design' | 'spec' | 'code' | 'visual' | 'learn';

export type ActionStatus = 'active' | 'coming-soon';

/**
 * An Action is an intent group — the top-level card in ActionsPanel.
 * Each Action groups one or more Intents that share a domain.
 * The actual agent, jobType, and pipeline config are determined
 * per-Intent via deriveFromIntent() and the config matrix.
 */
export interface ActionDefinition {
  readonly id: ActionId;
  readonly label: { en: string; ko: string };
  readonly description: { en: string; ko: string };
  readonly status: ActionStatus;
}

export const ACTION_DEFINITIONS: ReadonlyArray<ActionDefinition> = [
  {
    id: 'plan',
    label: { en: 'PRD', ko: '기획서' },
    description: { en: 'Create or revise product requirements', ko: '기획서를 작성하거나 보강합니다' },
    status: 'active',
  },
  {
    id: 'system-design',
    label: { en: 'System Design', ko: '시스템 설계' },
    description: { en: 'Design architecture, API contracts, and data models', ko: '아키텍처, API 계약, 데이터 모델을 설계합니다' },
    status: 'active',
  },
  {
    id: 'ui-design',
    label: { en: 'UI Design', ko: 'UI 설계' },
    description: { en: 'Design tokens, assets, and UI specifications', ko: '디자인 토큰, 에셋, UI 스펙을 설계합니다' },
    status: 'active',
  },
  {
    id: 'spec',
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
    id: 'learn',
    label: { en: 'Learn Codebase', ko: '코드베이스 학습' },
    description: { en: 'Analyze and index existing codebase', ko: '기존 코드를 분석하고 인덱싱합니다' },
    status: 'coming-soon',
  },
];

// ============================================
// Sub-modes (UI Design)
// ============================================

export type UIDesignModeId = 'figma' | 'references' | 'description';

export interface SubModeDefinition {
  readonly id: string;
  readonly label: { en: string; ko: string };
  readonly description: { en: string; ko: string };
}

export const UI_DESIGN_SUB_MODES: ReadonlyArray<SubModeDefinition> = [
  {
    id: 'figma',
    label: { en: 'Figma-based', ko: 'Figma 기반' },
    description: { en: 'Extract tokens, assets, and specs from Figma file', ko: 'Figma 파일에서 토큰, 에셋, 스펙을 추출합니다' },
  },
  {
    id: 'references',
    label: { en: 'Screenshot-based', ko: '스크린샷 기반' },
    description: { en: 'Analyze reference images to design UI', ko: '레퍼런스 이미지를 분석하여 UI를 설계합니다' },
  },
  {
    id: 'description',
    label: { en: 'Description-based', ko: '설명 기반' },
    description: { en: 'Design UI from text description (lower accuracy)', ko: '텍스트 설명으로 UI를 설계합니다 (정확도가 낮을 수 있음)' },
  },
];

// ============================================
// Detected execution modes (auto-detected, not user-selected)
// ============================================

export type CodeExecutionMode = 'spec-based' | 'design-doc-based' | 'directive-based';
export type DesignExecutionMode = 'generate' | 'refactor';

// ============================================
// Intent Definitions (first-class concept)
// ============================================

export interface IntentDefinition {
  readonly id: string;
  readonly actionId: ActionId;
  readonly label: { en: string; ko: string };
  readonly description: { en: string; ko: string };
}

export const INTENT_DEFINITIONS: ReadonlyArray<IntentDefinition> = [
  // Plan
  { id: 'create-plan', actionId: 'plan', label: { en: 'Create PRD', ko: '기획서 작성' }, description: { en: 'Generate a new product requirements document', ko: '새 기획서를 작성합니다' } },
  { id: 'revise-plan', actionId: 'plan', label: { en: 'Update PRD', ko: '기획서 업데이트' }, description: { en: 'Revise existing PRD document', ko: '기존 기획서를 업데이트합니다' } },

  // System Design
  { id: 'create-fe', actionId: 'system-design', label: { en: 'Frontend System', ko: '프론트엔드 시스템' }, description: { en: 'Design frontend architecture', ko: '프론트엔드 아키텍처를 설계합니다' } },
  { id: 'create-be', actionId: 'system-design', label: { en: 'Backend System', ko: '백엔드 시스템' }, description: { en: 'Design backend architecture and API contracts', ko: '백엔드 아키텍처와 API 계약을 설계합니다' } },
  { id: 'create-fullstack', actionId: 'system-design', label: { en: 'Fullstack System', ko: '풀스택 시스템' }, description: { en: 'Design full-stack architecture', ko: '풀스택 아키텍처를 설계합니다' } },
  { id: 'revise-system', actionId: 'system-design', label: { en: 'Update Design', ko: '설계 업데이트' }, description: { en: 'Revise existing system design documents', ko: '기존 시스템 설계 문서를 업데이트합니다' } },

  // UI Design
  { id: 'create-figma', actionId: 'ui-design', label: { en: 'Figma-based', ko: 'Figma 기반' }, description: { en: 'Extract design from Figma file', ko: 'Figma 파일에서 디자인을 추출합니다' } },
  { id: 'create-ref', actionId: 'ui-design', label: { en: 'Screenshot-based', ko: '스크린샷 기반' }, description: { en: 'Design UI from reference images', ko: '레퍼런스 이미지로 UI를 설계합니다' } },
  { id: 'create-desc', actionId: 'ui-design', label: { en: 'Description-based', ko: '설명 기반' }, description: { en: 'Design UI from text description', ko: '텍스트 설명으로 UI를 설계합니다' } },
  { id: 'revise-ui', actionId: 'ui-design', label: { en: 'Update UI Design', ko: 'UI 설계 업데이트' }, description: { en: 'Revise existing UI design documents', ko: '기존 UI 설계 문서를 업데이트합니다' } },

  // Spec
  { id: 'create-spec', actionId: 'spec', label: { en: 'Create Spec', ko: '스펙 작성' }, description: { en: 'Write implementation spec for a feature', ko: '기능의 구현 스펙을 작성합니다' } },
  { id: 'revise-spec', actionId: 'spec', label: { en: 'Update Spec', ko: '스펙 업데이트' }, description: { en: 'Revise existing spec document', ko: '기존 스펙 문서를 업데이트합니다' } },

  // Code
  { id: 'create-code', actionId: 'code', label: { en: 'Generate Code', ko: '코드 생성' }, description: { en: 'Generate code from design or directive', ko: '설계 또는 지시사항으로 코드를 생성합니다' } },
  { id: 'refactor-code', actionId: 'code', label: { en: 'Refactor Code', ko: '코드 리팩토링' }, description: { en: 'Refactor existing codebase', ko: '기존 코드를 리팩토링합니다' } },

  // Visual
  { id: 'create-visual', actionId: 'visual', label: { en: 'Generate Images', ko: '이미지 생성' }, description: { en: 'Generate images and visual assets', ko: '이미지와 비주얼 에셋을 생성합니다' } },

  // Learn (coming-soon)
  { id: 'create-learn', actionId: 'learn', label: { en: 'Learn Codebase', ko: '코드베이스 학습' }, description: { en: 'Analyze and index codebase', ko: '코드를 분석하고 인덱싱합니다' } },
];

/** Get intents available for a given action */
export function getIntentsForAction(actionId: ActionId): ReadonlyArray<IntentDefinition> {
  return INTENT_DEFINITIONS.filter(d => d.actionId === actionId);
}

// ============================================
// ActionMetadata (passed from FE to BE for explicit/infer pipeline)
// ============================================

export type Basis = 'prd' | 'directive' | 'existing-doc' | 'figma' | 'references' | 'spec' | 'design-doc';

export interface ActionMetadata {
  /** true = explicit pipeline (no inference, use only provided values). Set only via ActionsPanel "Start via Chat". */
  explicit?: boolean;
  /** When present, determines agent/job and bypasses triage */
  intent?: string;
  /** Target output file paths */
  target?: string[];
  /** What drives the generation */
  basis?: Basis;
  /** Primary reference file paths */
  refs?: string[];
  /** Secondary context file paths */
  context?: string[];
}

/**
 * Derive workType, jobMode, and environment from an intent string.
 * Used by detect node to bypass LLM when intent is provided.
 */
export function deriveFromIntent(intent: string): {
  workType?: 'ui-design' | 'system-design' | 'spec';
  jobMode: 'generate' | 'refactor' | 'explain';
  environment?: 'frontend' | 'backend' | 'fullstack';
  agent: string;
  jobType: string;
} {
  switch (intent) {
    case 'create-plan':
      return { jobMode: 'generate', agent: 'planner', jobType: 'plan' };
    case 'revise-plan':
      return { jobMode: 'refactor', agent: 'planner', jobType: 'plan' };

    case 'create-fe':
      return { workType: 'system-design', jobMode: 'generate', environment: 'frontend', agent: 'architect', jobType: 'design' };
    case 'create-be':
      return { workType: 'system-design', jobMode: 'generate', environment: 'backend', agent: 'architect', jobType: 'design' };
    case 'create-fullstack':
      return { workType: 'system-design', jobMode: 'generate', environment: 'fullstack', agent: 'architect', jobType: 'design' };
    case 'revise-system':
      return { workType: 'system-design', jobMode: 'refactor', agent: 'architect', jobType: 'design' };

    case 'create-figma':
    case 'create-ref':
    case 'create-desc':
      return { workType: 'ui-design', jobMode: 'generate', agent: 'architect', jobType: 'design' };
    case 'revise-ui':
      return { workType: 'ui-design', jobMode: 'refactor', agent: 'architect', jobType: 'design' };

    case 'create-spec':
      return { workType: 'spec', jobMode: 'generate', agent: 'architect', jobType: 'design' };
    case 'revise-spec':
      return { workType: 'spec', jobMode: 'refactor', agent: 'architect', jobType: 'design' };

    case 'create-code':
      return { jobMode: 'generate', agent: 'architect', jobType: 'code' };
    case 'refactor-code':
      return { jobMode: 'refactor', agent: 'architect', jobType: 'code' };

    case 'create-visual':
      return { jobMode: 'generate', agent: 'creator', jobType: 'visual' };

    case 'create-learn':
      return { jobMode: 'generate', agent: 'architect', jobType: 'learn' };

    default:
      return { jobMode: 'generate', agent: 'architect', jobType: 'design' };
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

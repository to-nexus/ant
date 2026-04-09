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

export interface ActionDefinition {
  readonly id: ActionId;
  readonly jobType: JobType;
  readonly agent: string;
  readonly label: { en: string; ko: string };
  readonly description: { en: string; ko: string };
  readonly hasSubModes: boolean;
  readonly status: ActionStatus;
}

export const ACTION_DEFINITIONS: ReadonlyArray<ActionDefinition> = [
  {
    id: 'plan',
    jobType: 'plan',
    agent: 'planner',
    label: { en: 'Create PRD', ko: '기획서 작성' },
    description: { en: 'Generate or refine a product requirements document', ko: 'PRD를 생성하거나 보강합니다' },
    hasSubModes: false,
    status: 'active',
  },
  {
    id: 'system-design',
    jobType: 'design',
    agent: 'architect',
    label: { en: 'System Design', ko: '시스템 설계' },
    description: { en: 'Design architecture, API contracts, and data models', ko: '아키텍처, API 계약, 데이터 모델을 설계합니다' },
    hasSubModes: false,
    status: 'active',
  },
  {
    id: 'ui-design',
    jobType: 'design',
    agent: 'architect',
    label: { en: 'UI Design', ko: 'UI 설계' },
    description: { en: 'Design tokens, assets, and UI specifications', ko: '디자인 토큰, 에셋, UI 스펙을 설계합니다' },
    hasSubModes: true,
    status: 'active',
  },
  {
    id: 'spec',
    jobType: 'design',
    agent: 'architect',
    label: { en: 'Feature Spec', ko: '기능 스펙 작성' },
    description: { en: 'Create implementation specs for a feature scope', ko: '특정 기능의 구현 계획을 작성합니다' },
    hasSubModes: false,
    status: 'active',
  },
  {
    id: 'code',
    jobType: 'code',
    agent: 'architect',
    label: { en: 'Code', ko: '코드 구현' },
    description: { en: 'Generate code from specs, design docs, or directives', ko: '스펙, 설계 문서, 또는 지시사항으로 코드를 생성합니다' },
    hasSubModes: false,
    status: 'active',
  },
  {
    id: 'visual',
    jobType: 'visual',
    agent: 'creator',
    label: { en: 'Generate Images', ko: '이미지 생성' },
    description: { en: 'Generate images, icons, and visual assets', ko: '이미지, 아이콘, 비주얼 에셋을 생성합니다' },
    hasSubModes: false,
    status: 'active',
  },
  {
    id: 'learn',
    jobType: 'learn',
    agent: 'architect',
    label: { en: 'Learn Codebase', ko: '코드베이스 학습' },
    description: { en: 'Analyze and index existing codebase', ko: '기존 코드를 분석하고 인덱싱합니다' },
    hasSubModes: false,
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
// Action Readiness Types (computed on frontend from fileTree + store)
// ============================================

export interface MaterialInfo {
  name: string;
  path: string;
  required: boolean;
  present: boolean;
  description: { en: string; ko: string };
  formatHint?: { en: string; ko: string };
  fileCount?: number;
}

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
  materials: MaterialInfo[];
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

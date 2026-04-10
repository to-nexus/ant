/**
 * File & Directory Description Registry
 *
 * Intent-independent metadata describing what each file pattern or directory is for.
 * Used by ActionConfigView to show info tooltips on refs, context, and target entries.
 */

// ============================================
// Types
// ============================================

export interface FilePatternDescription {
  /** Exact filename ('prd-refine.md') or prefix-wildcard ('fe-system-*.md') */
  pattern: string;
  description: { en: string; ko: string };
}

export interface DirDescription {
  path: string;
  description: { en: string; ko: string };
  /** Pattern keys referencing FILE_PATTERNS entries */
  expectedFiles?: string[];
}

// ============================================
// File pattern data
// ============================================

const FILE_PATTERNS: FilePatternDescription[] = [
  { pattern: 'prd-refine.md', description: { en: 'Ant refines your source documents into this structured PRD. Used as a primary reference for design and code generation.', ko: 'Ant가 소스 문서를 정제하여 만드는 구조화된 PRD입니다. 설계 및 코드 생성의 기본 참조로 사용됩니다.' } },
  { pattern: 'fe-system-*.md', description: { en: 'Frontend architecture document. Covers component structure, state management, routing, and rendering strategy. Multiple files possible for different services.', ko: '프론트엔드 아키텍처 문서입니다. 컴포넌트 구조, 상태관리, 라우팅, 렌더링 전략을 다룹니다. 서비스별로 여러 파일이 생성될 수 있습니다.' } },
  { pattern: 'be-system-*.md', description: { en: 'Backend architecture document. Covers API routing, data models, service layers, and infrastructure. Multiple files possible for different services.', ko: '백엔드 아키텍처 문서입니다. API 라우팅, 데이터 모델, 서비스 레이어, 인프라를 다룹니다. 서비스별로 여러 파일이 생성될 수 있습니다.' } },
  { pattern: 'api-contract-*.md', description: { en: 'API contract between frontend and backend. Defines endpoints, request/response payloads, and error schemas. Ensures FE/BE teams align on integration points.', ko: '프론트/백엔드 간 API 계약입니다. 엔드포인트, 요청/응답 페이로드, 에러 스키마를 정의합니다. FE/BE 팀 간 연동 지점을 맞추는 역할을 합니다.' } },
  { pattern: 'ui-tokens.json', description: { en: 'Design tokens extracted from Figma or generated from description. Defines colors, typography, spacing, and other visual primitives used across components.', ko: 'Figma에서 추출하거나 설명으로 생성한 디자인 토큰입니다. 컴포넌트 전반에서 사용하는 색상, 타이포, 간격 등의 시각적 기본값을 정의합니다.' } },
  { pattern: 'ui-assets.json', description: { en: 'UI asset metadata — icons, images, and illustrations referenced by the design. Used by code generation to correctly import and place visual assets.', ko: 'UI 에셋 메타데이터 — 디자인에서 참조하는 아이콘, 이미지, 일러스트입니다. 코드 생성 시 시각 에셋의 정확한 import와 배치에 사용됩니다.' } },
  { pattern: 'ui-spec.json', description: { en: 'UI component and page specifications. Describes layout, interactions, responsive behavior, and component hierarchy. The primary blueprint for frontend code generation.', ko: 'UI 컴포넌트/페이지 스펙입니다. 레이아웃, 상호작용, 반응형 동작, 컴포넌트 계층을 기술합니다. 프론트엔드 코드 생성의 핵심 청사진입니다.' } },
  { pattern: 'spec-*.md', description: { en: 'Feature implementation spec. Breaks down a feature into tasks with acceptance criteria, impact analysis, and code-level guidance. Scope one feature per file.', ko: '기능 구현 스펙입니다. 기능을 태스크 단위로 분해하고 수용 기준, 영향 분석, 코드 수준 가이드를 제공합니다. 하나의 기능 범위를 하나의 파일로 작성합니다.' } },
  { pattern: 'figma.json', description: { en: 'Figma file URL configuration. Point this to your Figma design file so Ant can extract tokens, assets, and specs via Figma Desktop MCP.', ko: 'Figma 파일 URL 설정입니다. Figma 디자인 파일을 지정하면 Ant가 Figma Desktop MCP를 통해 토큰, 에셋, 스펙을 추출합니다.' } },
];

// ============================================
// Directory data
// ============================================

const DIR_DESCRIPTIONS: DirDescription[] = [
  { path: 'inputs/sources', description: { en: 'Add multiple documents freely — PRD, requirements, tech stack constraints, business rules, etc. Each file is treated as a separate source for Ant to reference.', ko: '여러 문서를 자유롭게 추가할 수 있습니다 — PRD, 요구사항, 기술스택 제약, 비즈니스 규칙 등. 각 파일은 Ant가 참조하는 별도 소스로 처리됩니다.' } },
  { path: 'inputs/references', description: { en: 'Upload multiple screenshots or mockup images. Ant analyzes these to extract layout, colors, and component patterns for UI design.', ko: '여러 스크린샷이나 목업 이미지를 업로드할 수 있습니다. Ant가 이를 분석하여 레이아웃, 색상, 컴포넌트 패턴을 추출해 UI를 설계합니다.' } },
  { path: 'inputs/assets', description: { en: 'Project assets used in the design — icons, fonts, images. These are referenced during code generation to correctly import assets.', ko: '디자인에 사용되는 프로젝트 에셋 — 아이콘, 폰트, 이미지. 코드 생성 시 에셋을 올바르게 import하기 위해 참조됩니다.' } },
  { path: 'outputs/design', description: { en: 'All design outputs combined — system architecture, UI specs, and feature specs. Ant generates these from your source documents and references.', ko: '시스템 아키텍처, UI 스펙, 기능 스펙 등 모든 설계 산출물입니다. Ant가 소스 문서와 레퍼런스로부터 생성합니다.' }, expectedFiles: ['fe-system-*.md', 'be-system-*.md', 'api-contract-*.md', 'ui-tokens.json', 'ui-assets.json', 'ui-spec.json', 'spec-*.md'] },
  { path: 'outputs/design/system', description: { en: 'System design outputs — frontend/backend architecture and API contracts. Multiple files generated per service scope.', ko: '시스템 설계 산출물 — 프론트/백엔드 아키텍처와 API 계약. 서비스 범위별로 여러 파일이 생성됩니다.' }, expectedFiles: ['fe-system-*.md', 'be-system-*.md', 'api-contract-*.md'] },
  { path: 'outputs/design/ui', description: { en: 'UI design outputs — tokens, assets, and component specs. Generated from Figma, reference images, or text descriptions.', ko: 'UI 설계 산출물 — 토큰, 에셋, 컴포넌트 스펙. Figma, 레퍼런스 이미지, 또는 텍스트 설명으로부터 생성됩니다.' }, expectedFiles: ['ui-tokens.json', 'ui-assets.json', 'ui-spec.json'] },
  { path: 'outputs/design/spec', description: { en: 'Feature implementation specs — one file per feature scope. Used as the primary input for code generation.', ko: '기능 구현 스펙 — 기능 범위별 하나의 파일. 코드 생성의 주요 입력으로 사용됩니다.' }, expectedFiles: ['spec-*.md'] },
  { path: 'outputs/plan', description: { en: 'PRD output — Ant refines your source documents into a structured requirements document here.', ko: 'PRD 산출물 — Ant가 소스 문서를 정제하여 구조화된 요구사항 문서를 이곳에 생성합니다.' }, expectedFiles: ['prd-refine.md'] },
];

// ============================================
// Lookup helpers
// ============================================

function matchPattern(filename: string, pattern: string): boolean {
  if (!pattern.includes('*')) return filename === pattern;
  const [prefix, ext] = pattern.split('*');
  return filename.startsWith(prefix) && filename.endsWith(ext);
}

/**
 * Get description for a specific file.
 * Tries exact/pattern match first, falls back to parent directory description.
 */
export function getFileDescription(
  filename: string,
  dirPath?: string,
): { en: string; ko: string } | null {
  const match = FILE_PATTERNS.find(fp => matchPattern(filename, fp.pattern));
  if (match) return match.description;
  if (dirPath) return getDirDescription(dirPath)?.description ?? null;
  return null;
}

/**
 * Get description for a directory path.
 */
export function getDirDescription(dirPath: string): DirDescription | null {
  return DIR_DESCRIPTIONS.find(d => d.path === dirPath) ?? null;
}

/**
 * Get description for a file pattern string (used for target expectedFiles display).
 * Pattern like 'fe-system-*.md' matches directly.
 */
export function getPatternDescription(pattern: string): { en: string; ko: string } | null {
  const match = FILE_PATTERNS.find(fp => fp.pattern === pattern);
  return match?.description ?? null;
}

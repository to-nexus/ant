/**
 * Node phase labels — SSOT for chat-input token gauge tooltips
 * and Kanban estimating-phase banners.
 *
 * Two consumers, one map:
 *  - Estimating banner: shown during `triage` / `detect` / `decompose` / `figmaExplore`,
 *    resolved via `getEstimatingLabel(nodeId, locale)`.
 *  - Token gauge tooltip: shown for every LLM-calling node, resolved via
 *    `resolveNodePhaseLabel(phaseId, locale)` — same map, wider node coverage.
 *
 * Language is auto-detected from directive content (Korean → ko, else → en).
 */

export type UILocale = 'ko' | 'en';

const LABELS: Record<string, Record<UILocale, string>> = {
  // Shared pre-task / estimating nodes
  resolve:      { ko: '프로젝트 준비 중',      en: 'Preparing project' },
  triage:       { ko: '요청 분석 중',          en: 'Analyzing request' },
  detect:       { ko: '환경 분석 중',          en: 'Analyzing environment' },
  decompose:    { ko: '작업 계획 수립 중',     en: 'Planning tasks' },
  figmaExplore: { ko: 'Figma 탐색 중',        en: 'Exploring Figma' },
  revise:       { ko: '작업 계획 재검토 중',   en: 'Revising task plan' },

  // Architect (code) task-execution nodes
  plan:         { ko: '작업 계획 중',          en: 'Planning' },
  execute:      { ko: '코드 작성 중',          en: 'Executing' },

  // Architect (design) task-execution nodes
  docGen:       { ko: '문서 작성 중',          en: 'Generating document' },

  // Ask agent (question answering)
  agent:        { ko: '질문 처리 중',          en: 'Thinking' },

  // Planner agent nodes
  generate:     { ko: 'PRD 생성 중',           en: 'Generating PRD' },
  write:        { ko: 'PRD 저장 중',           en: 'Saving PRD' },

  // Creator agent (visual job) nodes
  classify:     { ko: '에셋 유형 분석 중',     en: 'Classifying asset type' },
  direct:       { ko: '프롬프트 설계 중',      en: 'Engineering prompt' },
  directCode:   { ko: '탐색 실행 중',          en: 'Exploring' },
  sketch:       { ko: '시안 생성 중',          en: 'Generating drafts' },
  render:       { ko: '최종 이미지 생성 중',   en: 'Rendering final image' },
  engrave:      { ko: 'SVG 코드 생성 중',      en: 'Generating SVG' },
  explain:      { ko: '설명 생성 중',          en: 'Explaining image' },
  deliver:      { ko: '결과물 저장 중',        en: 'Saving output' },
};

/**
 * Get a user-friendly label for a graph node (estimating banner).
 * Falls back to English if node ID is unknown.
 */
export function getEstimatingLabel(nodeId: string, locale: UILocale = 'en'): string {
  return LABELS[nodeId]?.[locale] ?? LABELS[nodeId]?.en ?? nodeId;
}

/**
 * Resolve the localized display label for a phase tracked by the token gauge.
 *
 * This is the SSOT label resolver for `withPhaseTracking()` / `beginNodePhase()`.
 * Falls back to the phaseId itself if the map has no entry, so unknown phases
 * still render something meaningful.
 */
export function resolveNodePhaseLabel(phaseId: string, locale: UILocale = 'en'): string {
  return LABELS[phaseId]?.[locale] ?? LABELS[phaseId]?.en ?? phaseId;
}

/**
 * Detect UI locale from directive text.
 * If the directive contains Korean characters → 'ko', otherwise → 'en'.
 */
export function detectUILocale(directive?: string | null): UILocale {
  if (!directive) return 'en';
  return /[가-힣]/.test(directive) ? 'ko' : 'en';
}

/**
 * Estimating Phase Labels
 * 
 * Centralized label map for non-task node activity banners.
 * Labels are shown on the Kanban board banner during pre-task phases.
 * Language is auto-detected from directive content (Korean → ko, else → en).
 */

export type UILocale = 'ko' | 'en';

const LABELS: Record<string, Record<UILocale, string>> = {
  resolve:   { ko: '프로젝트 준비 중',     en: 'Preparing project' },
  triage:    { ko: '요청 분석 중',         en: 'Analyzing request' },
  detect:    { ko: '환경 분석 중',         en: 'Analyzing environment' },
  decompose: { ko: '작업 계획 수립 중',    en: 'Planning tasks' },
  revise:    { ko: '작업 계획 재검토 중',   en: 'Revising task plan' },
  // Planner agent nodes
  generate:  { ko: 'PRD 생성 중',         en: 'Generating PRD' },
  write:     { ko: 'PRD 저장 중',         en: 'Saving PRD' },
  // Creator agent (visual job) nodes
  classify:  { ko: '에셋 유형 분석 중',    en: 'Classifying asset type' },
  direct:    { ko: '프롬프트 설계 중',     en: 'Engineering prompt' },
  sketch:    { ko: '시안 생성 중',         en: 'Generating drafts' },
  render:    { ko: '최종 이미지 생성 중',   en: 'Rendering final image' },
  engrave:   { ko: 'SVG 코드 생성 중',     en: 'Generating SVG' },
  deliver:   { ko: '결과물 저장 중',       en: 'Saving output' },
};

/**
 * Get a user-friendly label for a graph node.
 * Falls back to English if node ID is unknown.
 */
export function getEstimatingLabel(nodeId: string, locale: UILocale = 'en'): string {
  return LABELS[nodeId]?.[locale] ?? LABELS[nodeId]?.en ?? nodeId;
}

/**
 * Detect UI locale from directive text.
 * If the directive contains Korean characters → 'ko', otherwise → 'en'.
 */
export function detectUILocale(directive?: string | null): UILocale {
  if (!directive) return 'en';
  return /[가-힣]/.test(directive) ? 'ko' : 'en';
}

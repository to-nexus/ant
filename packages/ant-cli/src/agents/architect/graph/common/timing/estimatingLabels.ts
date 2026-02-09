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

/**
 * Game Content Tier Registry — Single Source of Truth (Phase 1)
 *
 * Game-domain only (D4). Two axes:
 *   - genre: action / puzzle / platformer / shooter / rpg / strategy / casual
 *   - coreLoop: collect / fight / build / explore / solve
 *
 * Phase 1 declares variants + template path functions; Phase 2 fills the
 * partials. Mechanics axis is deferred to Phase 3+.
 *
 * Template path SSOT: every variant emitted MUST have a `.md` file at the
 * path returned by GAME_CONTENT_TIER_TEMPLATE_PATHS; the registry-disk
 * 1:1 invariant is enforced by `tests/game-content-tier-registry.test.ts`
 * (Phase 1 stubs allowed).
 */

import type { GameGenreVariant, GameCoreLoopVariant } from './rac';
import type { BasisOption } from './tech-tier-registry';

// ============================================
// Variant Constants
// ============================================

export const GAME_GENRE_VARIANTS: readonly GameGenreVariant[] = [
  'action', 'puzzle', 'platformer', 'shooter',
  'rpg', 'strategy', 'casual',
] as const;

export const GAME_CORE_LOOP_VARIANTS: readonly GameCoreLoopVariant[] = [
  'collect', 'fight', 'build', 'explore', 'solve',
] as const;

export const GAME_CONTENT_TIER_AXIS_KEYS = ['genre', 'coreLoop'] as const;

export type GameContentTierAxisKey = (typeof GAME_CONTENT_TIER_AXIS_KEYS)[number];

// ============================================
// Template Path Functions
// ============================================

export const GAME_CONTENT_TIER_TEMPLATE_PATHS = {
  preamble: () => 'basis/gameContentTier/_preamble',
  jobPreamble: (job: string) => `jobs/${job}/basis/gameContentTier/_preamble`,
  genre: (v: string) => `basis/gameContentTier/genre/${v}`,
  coreLoop: (v: string) => `basis/gameContentTier/coreLoop/${v}`,
} as const;

// ============================================
// UI Options
// ============================================

export const GAME_GENRE_OPTIONS: BasisOption[] = [
  { id: 'action', label: { en: 'Action', ko: '액션' }, description: { en: 'Real-time combat / reaction-driven', ko: '실시간 전투 / 반응 중심' }, accentColor: 'red' },
  { id: 'puzzle', label: { en: 'Puzzle', ko: '퍼즐' }, description: { en: 'Match / line / logic boards', ko: '매치 / 라인 / 논리 보드' }, accentColor: 'violet' },
  { id: 'platformer', label: { en: 'Platformer', ko: '플랫포머' }, description: { en: 'Jump / traversal / level progression', ko: '점프 / 이동 / 레벨 진행' }, accentColor: 'green' },
  { id: 'shooter', label: { en: 'Shooter', ko: '슈터' }, description: { en: 'Projectile-centric combat', ko: '투사체 중심 전투' }, accentColor: 'amber' },
  { id: 'rpg', label: { en: 'RPG', ko: 'RPG' }, description: { en: 'Stats / inventory / quest progression', ko: '능력치 / 인벤토리 / 퀘스트 진행' }, accentColor: 'indigo' },
  { id: 'strategy', label: { en: 'Strategy', ko: '전략' }, description: { en: 'Resource / unit / turn-or-real-time tactics', ko: '자원 / 유닛 / 턴-실시간 전략' }, accentColor: 'slate' },
  { id: 'casual', label: { en: 'Casual', ko: '캐주얼' }, description: { en: 'Short sessions, low-friction onboarding', ko: '짧은 세션, 낮은 진입 장벽' }, accentColor: 'sky' },
];

export const GAME_CORE_LOOP_OPTIONS: BasisOption[] = [
  { id: 'collect', label: { en: 'Collect', ko: '수집' }, description: { en: 'Gather → progress (resources / cards / dex)', ko: '수집 → 진행 (자원 / 카드 / 도감)' }, accentColor: 'amber' },
  { id: 'fight', label: { en: 'Fight', ko: '전투' }, description: { en: 'Combat → reward → upgrade', ko: '전투 → 보상 → 강화' }, accentColor: 'red' },
  { id: 'build', label: { en: 'Build', ko: '건설' }, description: { en: 'Construct → produce → expand', ko: '건설 → 생산 → 확장' }, accentColor: 'green' },
  { id: 'explore', label: { en: 'Explore', ko: '탐험' }, description: { en: 'Discover → unlock → traverse', ko: '발견 → 해금 → 이동' }, accentColor: 'sky' },
  { id: 'solve', label: { en: 'Solve', ko: '해결' }, description: { en: 'Analyze → match → clear', ko: '분석 → 매치 → 클리어' }, accentColor: 'violet' },
];

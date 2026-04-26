/**
 * Game Content Tier Registry — Single Source of Truth
 *
 * Game-domain only (D4). Two axes:
 *   - genre: 5 sub-genres tuned for css-only inline production (D31-revised v8).
 *   - coreLoop: 3 universal patterns; the candidate set the LLM sees is
 *               narrowed per-genre by `GENRE_CORELOOP_MATRIX` (D31-revised v8).
 *
 * Template path SSOT: every variant emitted MUST have a `.md` file at the
 * path returned by GAME_CONTENT_TIER_TEMPLATE_PATHS; the registry-disk
 * 1:1 invariant is enforced by `tests/game-content-tier-registry.test.ts`.
 *
 * v8 (D31-revised) — genre 7→3 (v7) → 3→5 (v8). The 5 sub-genres carry
 * narrower commitments (board/match-rule, sliding-rule, card-suit,
 * paddle-physics, snake-grid) and are individually authorable in css-only
 * inline production. The matrix `GENRE_CORELOOP_MATRIX` keeps the
 * coreLoop candidate set short per-genre so the LLM cannot emit a
 * mismatched loop (e.g. `cardSolitaire + survive`).
 */

import type { GameGenreVariant, GameCoreLoopVariant } from './rac';
import type { BasisOption } from './tech-tier-registry';

// ============================================
// Variant Constants
// ============================================

export const GAME_GENRE_VARIANTS: readonly GameGenreVariant[] = [
  'match3',
  'slidingPuzzle',
  'cardSolitaire',
  'arcadePaddle',
  'arcadeSnake',
] as const;

export const GAME_CORE_LOOP_VARIANTS: readonly GameCoreLoopVariant[] = [
  'solve',
  'collect',
  'survive',
] as const;

export const GAME_CONTENT_TIER_AXIS_KEYS = ['genre', 'coreLoop'] as const;

export type GameContentTierAxisKey = (typeof GAME_CONTENT_TIER_AXIS_KEYS)[number];

// ============================================
// Genre × CoreLoop Matrix (D31-revised v8 — I9 SSOT)
// ============================================
//
// The matrix is the SOLE SSOT for "which coreLoops are reachable given a
// genre". Decompose's `gameCoreLoopCandidates` enrichedVar consults this
// (via `coreLoopCandidatesFor`) once a genre is resolved; before that, the
// full universe (`GAME_CORE_LOOP_VARIANTS`) is exposed. Adding a new genre
// or relaxing a row is a single-line edit — the decision pipeline never
// branches on genre values. Mismatched LLM emissions (e.g. cardSolitaire +
// survive) are filtered at parse time.

export const GENRE_CORELOOP_MATRIX: Readonly<Record<GameGenreVariant, ReadonlyArray<GameCoreLoopVariant>>> = {
  match3:        ['solve', 'collect'],
  slidingPuzzle: ['solve'],
  cardSolitaire: ['solve', 'collect'],
  arcadePaddle:  ['survive', 'collect'],
  arcadeSnake:   ['survive', 'collect'],
} as const;

/**
 * Returns the coreLoop candidate set narrowed by the matrix for a given
 * genre. When `genre` is undefined (genre still pending), falls back to
 * the universal `GAME_CORE_LOOP_VARIANTS` — the LLM sees the full set on
 * the first pass and gets the narrowed set on retry once it has decided
 * the genre. Used by `decompose/index.ts` enrichedVars serialization.
 */
export function coreLoopCandidatesFor(
  genre: GameGenreVariant | undefined,
): ReadonlyArray<GameCoreLoopVariant> {
  if (!genre) return GAME_CORE_LOOP_VARIANTS;
  return GENRE_CORELOOP_MATRIX[genre] ?? GAME_CORE_LOOP_VARIANTS;
}

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
  { id: 'match3', label: { en: 'Match-3', ko: '매치-3' }, description: { en: 'Grid + 3-in-a-row + cascading drops (Bejeweled / Candy Crush)', ko: '그리드 + 3-매치 + 캐스케이드 (Bejeweled / Candy Crush)' }, accentColor: 'violet' },
  { id: 'slidingPuzzle', label: { en: 'Sliding Puzzle', ko: '슬라이딩 퍼즐' }, description: { en: 'Grid + position manipulation (15-puzzle / Sokoban / Color Sliders)', ko: '그리드 + 위치 조작 (15-퍼즐 / Sokoban)' }, accentColor: 'sky' },
  { id: 'cardSolitaire', label: { en: 'Card Solitaire', ko: '카드 솔리테어' }, description: { en: 'Card stacks + suit/number matching (Solitaire / FreeCell / Memory)', ko: '카드 스택 + suit/숫자 매칭 (Solitaire / FreeCell)' }, accentColor: 'green' },
  { id: 'arcadePaddle', label: { en: 'Arcade Paddle', ko: '아케이드 패들' }, description: { en: 'Paddle + ball + brick (Pong / Breakout)', ko: 'paddle + ball + brick (Pong / Breakout)' }, accentColor: 'amber' },
  { id: 'arcadeSnake', label: { en: 'Arcade Snake', ko: '아케이드 스네이크' }, description: { en: 'Grid movement + body/obstacle avoidance (Snake / Tron / Frogger)', ko: '그리드 이동 + 자기몸/장애물 회피 (Snake / Tron / Frogger)' }, accentColor: 'red' },
];

export const GAME_CORE_LOOP_OPTIONS: BasisOption[] = [
  { id: 'solve', label: { en: 'Solve', ko: '해결' }, description: { en: 'Observe → hypothesize → act → confirm (puzzle-class)', ko: '관찰 → 가설 → 행동 → 확인 (퍼즐 계열)' }, accentColor: 'violet' },
  { id: 'collect', label: { en: 'Collect', ko: '수집' }, description: { en: 'Gather → progress (chains, suits, points)', ko: '수집 → 진행 (체인, suit, 점수)' }, accentColor: 'amber' },
  { id: 'survive', label: { en: 'Survive', ko: '생존' }, description: { en: 'Avoid failure → ramping difficulty (paddle/snake)', ko: '실패 회피 → 난이도 상승 (paddle/snake)' }, accentColor: 'red' },
];

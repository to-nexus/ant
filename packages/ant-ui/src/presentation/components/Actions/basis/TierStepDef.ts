/**
 * TIER_STEP_DEF — per-tier WizardStepDef[] map (Phase 2 — D12-revised + D23)
 *
 * Mirrors the BE matrix-driven `isTierActive`. The wizard derives the
 * full step set by:
 *
 *   1. listing active tiers via the matrix predicate,
 *   2. concatenating `TIER_STEP_DEF[tier]` for each.
 *
 * Phase 2 Step set:
 *   - techTier:        [stack, language, framework, gameEngine?]
 *                      (FULLSTACK_STEPS used when stack=fullstack)
 *   - visualTier:      [visualLanguage, surfaceSystem]
 *   - gameArtTier:     [concept, perspective]      (Phase 4 adds 5 axes)
 *   - gameContentTier: [genre, coreLoop]
 *
 * Note: techTier is special — it has dynamic step ordering that depends
 * on the chosen stack (fullstack vs single). The single-stack ordering
 * lives in `constants.ts` as `TECH_STEPS` and is re-exposed here for
 * `TIER_STEP_DEF`. useBasisWizard handles the fullstack branching via
 * `computeTechSteps` (separate code path).
 */

import type { WizardStepDef, TierKey } from './types';
import { TECH_STEPS, FULLSTACK_STEPS, VISUAL_STEPS } from './constants';

// Game engine step — appended to TECH_STEPS only when domain=game and the
// chosen stack ⊆ {frontend, fullstack} (game projects don't run on
// backend-only stacks). Selection is technically optional (defaults to
// 'phaser' via `BasisSlotConfig.defaults[game]`) but exposing it lets
// users override.
export const GAME_ENGINE_STEP: WizardStepDef = {
  id: 'gameEngine',
  tierKey: 'techTier',
  layerKey: 'gameEngine',
  title: { en: 'Game Engine', ko: '게임 엔진' },
  description: { en: 'Select the sub-engine that runs inside the framework', ko: '프레임워크 내부에서 동작할 서브 엔진을 선택하세요' },
};

export const GAME_ART_STEPS: WizardStepDef[] = [
  {
    id: 'concept',
    tierKey: 'gameArtTier',
    layerKey: 'concept',
    title: { en: 'Concept', ko: '컨셉' },
    description: { en: 'Choose the overall art tone and silhouette palette', ko: '전체 아트 톤과 실루엣 팔레트를 선택하세요' },
  },
  {
    id: 'perspective',
    tierKey: 'gameArtTier',
    layerKey: 'perspective',
    title: { en: 'Perspective', ko: '시점' },
    description: { en: 'Choose the camera / depth model (2D vs 3D)', ko: '카메라/깊이 모델 (2D vs 3D) 을 선택하세요' },
  },
];

export const GAME_CONTENT_STEPS: WizardStepDef[] = [
  {
    id: 'genre',
    tierKey: 'gameContentTier',
    layerKey: 'genre',
    title: { en: 'Genre', ko: '장르' },
    description: { en: 'Pick the genre identity (puzzle / action / ...)', ko: '게임 장르 (퍼즐 / 액션 / ...) 를 선택하세요' },
  },
  {
    id: 'coreLoop',
    tierKey: 'gameContentTier',
    layerKey: 'coreLoop',
    title: { en: 'Core Loop', ko: '코어 루프' },
    description: { en: 'Select the player loop pattern', ko: '플레이어 코어 루프 패턴을 선택하세요' },
  },
];

/**
 * TIER_STEP_DEF — single source of truth for "given an active tier, which
 * steps does the wizard expose?". `useBasisWizard.computeStepsByTier`
 * iterates this map ordered by `TIER_KEYS` (matrix order).
 *
 * Note: techTier's `single`/`fullstack` branching is dynamic and stays
 * inside `useBasisWizard`. The map exposes the canonical `single` order
 * here as the primary export for symmetry, plus `fullstack` for the
 * branched path.
 */
export const TIER_STEP_DEF: Readonly<Record<TierKey, WizardStepDef[]>> = {
  techTier: [...TECH_STEPS],
  visualTier: [...VISUAL_STEPS],
  gameArtTier: GAME_ART_STEPS,
  gameContentTier: GAME_CONTENT_STEPS,
} as const;

export const TIER_STEP_DEF_FULLSTACK_TECH: WizardStepDef[] = [...FULLSTACK_STEPS];

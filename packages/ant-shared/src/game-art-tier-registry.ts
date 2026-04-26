/**
 * Game Art Tier Registry — Single Source of Truth (Phase 2 — D12-revised)
 *
 * Game-domain art policy. The matrix gate
 * ([packages/ant-shared/src/tier-matrix.ts]) allows only `'game'` (D12-revised
 * — game-only naming, future non-game art-heavy domains get their own tier).
 *
 * 7-axis structure (D3 / D15):
 *   - Phase 2: types defined for all 7 axes (forward-compat); registry
 *     populates concept / perspective only. Phase 4 fills the remaining 5.
 *
 * Template path SSOT: every variant emitted by this registry MUST have a
 * corresponding `.md` file at the path returned by GAME_ART_TIER_TEMPLATE_PATHS;
 * `tests/game-art-tier-registry.test.ts` enforces 1:1 registry-disk parity.
 *
 * Rename history (D12-revised, Phase 2): the previous `art-tier-registry.ts`
 * with `ART_*` constants was renamed to `game-art-tier-registry.ts` with
 * `GAME_ART_*` constants. Compat re-exports under the old `ART_*` names are
 * kept temporarily for callsites still referring to the Phase 1 names.
 */

import type {
  GameArtConceptVariant,
  GameArtPerspectiveVariant,
  GameArtEntityCatalogVariant,
  GameArtMotionPatternVariant,
  GameArtParticleProfileVariant,
  GameArtProjectilePolicyVariant,
  GameArtAudioProfileVariant,
} from './rac';
import type { BasisOption } from './tech-tier-registry';

// ============================================
// Variant Constants
// ============================================

export const GAME_ART_CONCEPT_VARIANTS: readonly GameArtConceptVariant[] = [
  'sfFantasy', 'darkFantasy', 'threeKingdoms', 'martialArts',
  'modernCasual', 'pixelRetro',
] as const;

export const GAME_ART_PERSPECTIVE_VARIANTS: readonly GameArtPerspectiveVariant[] = [
  '2d', '3d',
] as const;

// Phase 4 axis — variants are typed but registry populates them with
// stub-only entries today. Phase 4 ships full content + UI options.
export const GAME_ART_ENTITY_CATALOG_VARIANTS: readonly GameArtEntityCatalogVariant[] = [
  'minimal', 'standard', 'rich',
] as const;

export const GAME_ART_MOTION_PATTERN_VARIANTS: readonly GameArtMotionPatternVariant[] = [
  'static', 'subtle', 'expressive',
] as const;

export const GAME_ART_PARTICLE_PROFILE_VARIANTS: readonly GameArtParticleProfileVariant[] = [
  'none', 'light', 'heavy',
] as const;

export const GAME_ART_PROJECTILE_POLICY_VARIANTS: readonly GameArtProjectilePolicyVariant[] = [
  'none', 'simple', 'complex',
] as const;

export const GAME_ART_AUDIO_PROFILE_VARIANTS: readonly GameArtAudioProfileVariant[] = [
  'procedural', 'fileBased', 'hybrid',
] as const;

/** Axis keys in stable iteration order — used by buildBasisSection. */
export const GAME_ART_TIER_AXIS_KEYS = [
  'concept',
  'perspective',
  'entityCatalog',
  'motionPattern',
  'particleProfile',
  'projectilePolicy',
  'audioProfile',
] as const;

export type GameArtTierAxisKey = (typeof GAME_ART_TIER_AXIS_KEYS)[number];

// ============================================
// Template Path Functions
// ============================================

export const GAME_ART_TIER_TEMPLATE_PATHS = {
  preamble: () => 'basis/gameArtTier/_preamble',
  jobPreamble: (job: string) => `jobs/${job}/basis/gameArtTier/_preamble`,
  concept: (v: string) => `basis/gameArtTier/concept/${v}`,
  perspective: (v: string) => `basis/gameArtTier/perspective/${v}`,
  entityCatalog: (v: string) => `basis/gameArtTier/entityCatalog/${v}`,
  motionPattern: (v: string) => `basis/gameArtTier/motionPattern/${v}`,
  particleProfile: (v: string) => `basis/gameArtTier/particleProfile/${v}`,
  projectilePolicy: (v: string) => `basis/gameArtTier/projectilePolicy/${v}`,
  audioProfile: (v: string) => `basis/gameArtTier/audioProfile/${v}`,
} as const;

// ============================================
// UI Options (BasisOption arrays — Phase 2: concept + perspective)
// ============================================

export const GAME_ART_CONCEPT_OPTIONS: BasisOption[] = [
  { id: 'sfFantasy', label: { en: 'SF Fantasy', ko: 'SF 판타지' }, description: { en: 'Sci-fi + fantasy hybrid (space opera, cyber-mage)', ko: 'SF + 판타지 혼합 (스페이스 오페라, 사이버 마법사)' }, accentColor: 'violet' },
  { id: 'darkFantasy', label: { en: 'Dark Fantasy', ko: '다크 판타지' }, description: { en: 'Gothic, somber palette with high contrast', ko: '고딕한 침울한 팔레트와 높은 대비' }, accentColor: 'slate' },
  { id: 'threeKingdoms', label: { en: 'Three Kingdoms', ko: '삼국지' }, description: { en: 'Classical Eastern epic, ink-and-wash silhouettes', ko: '동양 고전 서사, 수묵화 실루엣' }, accentColor: 'amber' },
  { id: 'martialArts', label: { en: 'Martial Arts', ko: '무협' }, description: { en: 'Wuxia palette, fluid combat silhouettes', ko: '무협 팔레트, 유연한 전투 실루엣' }, accentColor: 'red' },
  { id: 'modernCasual', label: { en: 'Modern Casual', ko: '모던 캐주얼' }, description: { en: 'Bright, playful, mobile-game-friendly', ko: '밝고 플레이풀, 모바일 게임 친화적' }, accentColor: 'sky' },
  { id: 'pixelRetro', label: { en: 'Pixel Retro', ko: '픽셀 레트로' }, description: { en: '8/16-bit pixel aesthetic with limited palette', ko: '8/16비트 픽셀 미학과 제한된 팔레트' }, accentColor: 'orange' },
];

export const GAME_ART_PERSPECTIVE_OPTIONS: BasisOption[] = [
  { id: '2d', label: { en: '2D', ko: '2D' }, description: { en: 'Flat 2D camera (top-down / side / iso)', ko: '평면 2D 카메라 (탑다운 / 사이드 / 아이소메트릭)' }, accentColor: 'blue' },
  { id: '3d', label: { en: '3D', ko: '3D' }, description: { en: 'Perspective / orthographic 3D camera', ko: '투시 / 직교 3D 카메라' }, accentColor: 'indigo' },
];

// Phase 4 axis options — empty arrays today; Phase 4 populates full lists.
export const GAME_ART_ENTITY_CATALOG_OPTIONS: BasisOption[] = [];
export const GAME_ART_MOTION_PATTERN_OPTIONS: BasisOption[] = [];
export const GAME_ART_PARTICLE_PROFILE_OPTIONS: BasisOption[] = [];
export const GAME_ART_PROJECTILE_POLICY_OPTIONS: BasisOption[] = [];
export const GAME_ART_AUDIO_PROFILE_OPTIONS: BasisOption[] = [];
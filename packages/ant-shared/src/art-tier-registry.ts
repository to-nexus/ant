/**
 * Art Tier Registry — Single Source of Truth (Phase 1)
 *
 * Domain-agnostic art policy. The matrix gate
 * ([packages/ant-shared/src/tier-matrix.ts]) currently allows only `'game'`
 * but the registry itself contains no domain assumptions — Phase 4+ adds
 * `'3d'` / `'data-viz'` / `'interactive-art'` by extending only the matrix
 * row plus this registry's variant lists.
 *
 * 7-axis structure (D3 / D15):
 *   - Phase 1: types defined for all 7 axes (forward-compat); registry
 *     populates concept / perspective only. Phase 3 fills the remaining 5.
 *
 * Template path SSOT: every variant emitted by this registry MUST have a
 * corresponding `.md` file at the path returned by ART_TIER_TEMPLATE_PATHS;
 * `tests/art-tier-registry.test.ts` enforces 1:1 registry-disk parity.
 */

import type {
  ArtConceptVariant,
  ArtPerspectiveVariant,
  ArtEntityCatalogVariant,
  ArtMotionPatternVariant,
  ArtParticleProfileVariant,
  ArtProjectilePolicyVariant,
  ArtAudioProfileVariant,
} from './rac';
import type { BasisOption } from './tech-tier-registry';

// ============================================
// Variant Constants
// ============================================

export const ART_CONCEPT_VARIANTS: readonly ArtConceptVariant[] = [
  'sfFantasy', 'darkFantasy', 'threeKingdoms', 'martialArts',
  'modernCasual', 'pixelRetro',
] as const;

export const ART_PERSPECTIVE_VARIANTS: readonly ArtPerspectiveVariant[] = [
  '2d', '3d',
] as const;

// Phase 3 axis — variants are typed but registry populates them with
// stub-only entries today. Phase 3 ships full content + UI options.
export const ART_ENTITY_CATALOG_VARIANTS: readonly ArtEntityCatalogVariant[] = [
  'minimal', 'standard', 'rich',
] as const;

export const ART_MOTION_PATTERN_VARIANTS: readonly ArtMotionPatternVariant[] = [
  'static', 'subtle', 'expressive',
] as const;

export const ART_PARTICLE_PROFILE_VARIANTS: readonly ArtParticleProfileVariant[] = [
  'none', 'light', 'heavy',
] as const;

export const ART_PROJECTILE_POLICY_VARIANTS: readonly ArtProjectilePolicyVariant[] = [
  'none', 'simple', 'complex',
] as const;

export const ART_AUDIO_PROFILE_VARIANTS: readonly ArtAudioProfileVariant[] = [
  'procedural', 'fileBased', 'hybrid',
] as const;

/** Axis keys in stable iteration order — used by buildBasisSection. */
export const ART_TIER_AXIS_KEYS = [
  'concept',
  'perspective',
  'entityCatalog',
  'motionPattern',
  'particleProfile',
  'projectilePolicy',
  'audioProfile',
] as const;

export type ArtTierAxisKey = (typeof ART_TIER_AXIS_KEYS)[number];

// ============================================
// Template Path Functions
// ============================================

export const ART_TIER_TEMPLATE_PATHS = {
  preamble: () => 'basis/artTier/_preamble',
  jobPreamble: (job: string) => `jobs/${job}/basis/artTier/_preamble`,
  concept: (v: string) => `basis/artTier/concept/${v}`,
  perspective: (v: string) => `basis/artTier/perspective/${v}`,
  entityCatalog: (v: string) => `basis/artTier/entityCatalog/${v}`,
  motionPattern: (v: string) => `basis/artTier/motionPattern/${v}`,
  particleProfile: (v: string) => `basis/artTier/particleProfile/${v}`,
  projectilePolicy: (v: string) => `basis/artTier/projectilePolicy/${v}`,
  audioProfile: (v: string) => `basis/artTier/audioProfile/${v}`,
} as const;

// ============================================
// UI Options (BasisOption arrays — Phase 1: concept + perspective)
// ============================================

export const ART_CONCEPT_OPTIONS: BasisOption[] = [
  { id: 'sfFantasy', label: { en: 'SF Fantasy', ko: 'SF 판타지' }, description: { en: 'Sci-fi + fantasy hybrid (space opera, cyber-mage)', ko: 'SF + 판타지 혼합 (스페이스 오페라, 사이버 마법사)' }, accentColor: 'violet' },
  { id: 'darkFantasy', label: { en: 'Dark Fantasy', ko: '다크 판타지' }, description: { en: 'Gothic, somber palette with high contrast', ko: '고딕한 침울한 팔레트와 높은 대비' }, accentColor: 'slate' },
  { id: 'threeKingdoms', label: { en: 'Three Kingdoms', ko: '삼국지' }, description: { en: 'Classical Eastern epic, ink-and-wash silhouettes', ko: '동양 고전 서사, 수묵화 실루엣' }, accentColor: 'amber' },
  { id: 'martialArts', label: { en: 'Martial Arts', ko: '무협' }, description: { en: 'Wuxia palette, fluid combat silhouettes', ko: '무협 팔레트, 유연한 전투 실루엣' }, accentColor: 'red' },
  { id: 'modernCasual', label: { en: 'Modern Casual', ko: '모던 캐주얼' }, description: { en: 'Bright, playful, mobile-game-friendly', ko: '밝고 플레이풀, 모바일 게임 친화적' }, accentColor: 'sky' },
  { id: 'pixelRetro', label: { en: 'Pixel Retro', ko: '픽셀 레트로' }, description: { en: '8/16-bit pixel aesthetic with limited palette', ko: '8/16비트 픽셀 미학과 제한된 팔레트' }, accentColor: 'orange' },
];

export const ART_PERSPECTIVE_OPTIONS: BasisOption[] = [
  { id: '2d', label: { en: '2D', ko: '2D' }, description: { en: 'Flat 2D camera (top-down / side / iso)', ko: '평면 2D 카메라 (탑다운 / 사이드 / 아이소메트릭)' }, accentColor: 'blue' },
  { id: '3d', label: { en: '3D', ko: '3D' }, description: { en: 'Perspective / orthographic 3D camera', ko: '투시 / 직교 3D 카메라' }, accentColor: 'indigo' },
];

// Phase 3 axis options — empty arrays today; Phase 3 populates full lists.
export const ART_ENTITY_CATALOG_OPTIONS: BasisOption[] = [];
export const ART_MOTION_PATTERN_OPTIONS: BasisOption[] = [];
export const ART_PARTICLE_PROFILE_OPTIONS: BasisOption[] = [];
export const ART_PROJECTILE_POLICY_OPTIONS: BasisOption[] = [];
export const ART_AUDIO_PROFILE_OPTIONS: BasisOption[] = [];

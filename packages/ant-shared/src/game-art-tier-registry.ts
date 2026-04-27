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
 * `GAME_ART_*` constants. No BC re-exports — D28 hard rename.
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

/**
 * v9 (D32-revised) — 5 concepts tuned for the design-time inline-payload
 * ceiling and the 6 sub-genres registered by D31-revised v9. The concept
 * registry is intentionally smaller than the genre registry — concepts
 * generalise across genres (a `flatMinimal` look fits `match3` /
 * `arcadePaddle` / `crowdRunner` alike). `pixelRetro` is the only concept
 * carried over from Phase 3; the rest are post-v7 (`flatMinimal` /
 * `neonArcade`) plus v8 additions (`softPastel` / `cardClassic`). Phase
 * 5+ widens the union when production assets are authored.
 */
export const GAME_ART_CONCEPT_VARIANTS: readonly GameArtConceptVariant[] = [
  'flatMinimal',
  'pixelRetro',
  'neonArcade',
  'softPastel',
  'cardClassic',
] as const;

/**
 * v7 (D30): `GAME_ART_PERSPECTIVE_VARIANTS` is a single-element registry
 * today (`['2d']`). Phaser 3 is a 2D HTML5 engine; production 3D requires
 * glTF models / lighting / scene graph that cannot be authored within the
 * design-time inline-payload ceiling. Three.js / `enable3d` / `Phaser3D`
 * integrations are Phase 5+ hooks (visual job activates 3D production
 * assets first). The decision pipeline is unchanged —
 * `gameArtPerspectiveCandidates` still serializes the (cardinality-1)
 * candidate list and the LLM still emits
 * `<gameArtTier>...,perspective=2d,...</gameArtTier>` through the normal
 * channel.
 */
export const GAME_ART_PERSPECTIVE_VARIANTS: readonly GameArtPerspectiveVariant[] = [
  '2d',
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
  { id: 'flatMinimal', label: { en: 'Flat Minimal', ko: '플랫 미니멀' }, description: { en: 'Material/iOS rounded shapes, single-accent palette, no shadow', ko: 'Material/iOS 둥근 도형, 단색 + 강조 1~2 색, 무그림자' }, accentColor: 'sky' },
  { id: 'pixelRetro', label: { en: 'Pixel Retro', ko: '픽셀 레트로' }, description: { en: '8/16-bit pixel aesthetic with limited palette', ko: '8/16비트 픽셀 미학과 제한된 팔레트' }, accentColor: 'orange' },
  { id: 'neonArcade', label: { en: 'Neon Arcade', ko: '네온 아케이드' }, description: { en: 'Tron / synthwave — dark background with neon glow lines', ko: 'Tron / 신스웨이브 — 어두운 배경 + 네온 보색 글로우' }, accentColor: 'violet' },
  { id: 'softPastel', label: { en: 'Soft Pastel', ko: '소프트 파스텔' }, description: { en: 'Pastel hues, pillowy gradients (Two Dots / Threes tone)', ko: '파스텔 hue, 부드러운 그라디언트 (Two Dots / Threes 톤)' }, accentColor: 'pink' },
  { id: 'cardClassic', label: { en: 'Card Classic', ko: '클래식 카드' }, description: { en: 'Green felt + white card face + suit pictograms (Solitaire tone)', ko: '녹색 펠트 + 흰 카드 면 + suit 픽토그램 (Solitaire 톤)' }, accentColor: 'green' },
];

export const GAME_ART_PERSPECTIVE_OPTIONS: BasisOption[] = [
  { id: '2d', label: { en: '2D', ko: '2D' }, description: { en: 'Flat 2D camera (top-down / side / iso). Phaser 3 native; 3D deferred to Phase 5+.', ko: '평면 2D 카메라 (탑다운 / 사이드 / 아이소메트릭). Phaser 3 기본; 3D 는 Phase 5+ 로 연기.' }, accentColor: 'blue' },
];

// Phase 4 axis options — populated for the 7-step wizard. Each option's
// description summarizes the axis variant in one sentence (the partial
// `.md` carries the full body).
export const GAME_ART_ENTITY_CATALOG_OPTIONS: BasisOption[] = [
  { id: 'minimal', label: { en: 'Minimal', ko: '미니멀' }, description: { en: 'Single shape per role (≤3 entities) — match-3 gem, snake body cell, paddle/ball/brick', ko: '역할별 단일 도형 (≤3 엔티티) — 매치-3 젬, 스네이크 몸체, 패들/볼/브릭' }, accentColor: 'sky' },
  { id: 'standard', label: { en: 'Standard', ko: '스탠다드' }, description: { en: 'Hero + 1–2 antagonists + 1–2 collectibles (2–4 distinct entities, inline composable)', ko: '히어로 + 적 1~2 + 수집품 1~2 (2~4 엔티티, 인라인 합성)' }, accentColor: 'green' },
  { id: 'rich', label: { en: 'Rich', ko: '리치' }, description: { en: 'Multi-character roster + animation cycles (5+ entries, Phase 5+ recommended)', ko: '다중 캐릭터 + 애니메이션 사이클 (5+ 엔트리, Phase 5+ 권장)' }, accentColor: 'violet' },
];

export const GAME_ART_MOTION_PATTERN_OPTIONS: BasisOption[] = [
  { id: 'static', label: { en: 'Static', ko: '스태틱' }, description: { en: 'Discrete position changes — snap-to-grid, no tween. Pixel/sliding/snake.', ko: '이산적 위치 변경 — 그리드 스냅, 트윈 없음. 픽셀/슬라이딩/스네이크.' }, accentColor: 'slate' },
  { id: 'subtle', label: { en: 'Subtle', ko: '서틀' }, description: { en: 'Ease-in-out tweens, 150–400ms. Match-3 cascade, card flip + settle.', ko: 'ease-in-out 트윈, 150–400ms. 매치-3 캐스케이드, 카드 플립.' }, accentColor: 'sky' },
  { id: 'expressive', label: { en: 'Expressive', ko: '익스프레시브' }, description: { en: 'Spring/bounce/squash, chained tweens, screen shake. Paddle/Breakout juicy feel.', ko: '스프링/바운스/스쿼시, 트윈 체인, 스크린 셰이크. 패들/브레이크아웃 쥬시 톤.' }, accentColor: 'red' },
];

export const GAME_ART_PARTICLE_PROFILE_OPTIONS: BasisOption[] = [
  { id: 'none', label: { en: 'None', ko: '없음' }, description: { en: 'Zero particle emitters — sliding/card classic prefer this', ko: '파티클 없음 — 슬라이딩/카드 클래식 권장' }, accentColor: 'slate' },
  { id: 'light', label: { en: 'Light', ko: '라이트' }, description: { en: '5–10 particles per event, single-texture bursts (match-clear spark, food eat)', ko: '이벤트당 5~10 파티클, 단일 텍스처 (매치 클리어, 음식 수집)' }, accentColor: 'amber' },
  { id: 'heavy', label: { en: 'Heavy', ko: '헤비' }, description: { en: '50+ particles, ambient emitters, multi-texture mixes (paddle/breakout, juicy match-3)', ko: '50+ 파티클, 앰비언트 이미터, 멀티 텍스처 (패들/브레이크아웃)' }, accentColor: 'red' },
];

export const GAME_ART_PROJECTILE_POLICY_OPTIONS: BasisOption[] = [
  { id: 'none', label: { en: 'None', ko: '없음' }, description: { en: 'Zero projectiles — canonical for 5 of 6 v9 sub-genres (match3 / slidingPuzzle / cardSolitaire / arcadePaddle / arcadeSnake)', ko: '투사체 없음 — v9 6종 중 5종 (match3 등) 기본값' }, accentColor: 'slate' },
  { id: 'simple', label: { en: 'Simple', ko: '심플' }, description: { en: 'One projectile kind, straight-line motion, single-hit — canonical for crowdRunner; rare in the other v9 sub-genres', ko: '단일 투사체, 직선 이동, 단발 충돌 — crowdRunner 기본값' }, accentColor: 'amber' },
  { id: 'complex', label: { en: 'Complex', ko: '컴플렉스' }, description: { en: 'Multi-kind + homing/spread/piercing (crowdRunner with rich op universe; Phase 5+ recommended for bullet-hell / RPG super-categories)', ko: '다종 + 호밍/확산/관통 (crowdRunner 의 풍부한 op universe 또는 Phase 5+ 권장 — 불릿헬, RPG)' }, accentColor: 'violet' },
];

export const GAME_ART_AUDIO_PROFILE_OPTIONS: BasisOption[] = [
  { id: 'procedural', label: { en: 'Procedural', ko: '프로시저럴' }, description: { en: 'Web Audio OscillatorNode SFX, no external files — Phase 3 default', ko: 'Web Audio 오실레이터 SFX, 외부 파일 없음 — Phase 3 기본값' }, accentColor: 'sky' },
  { id: 'fileBased', label: { en: 'File-Based', ko: '파일 기반' }, description: { en: 'External .mp3/.ogg/.wav under inputs/assets/game/{sfx,bgm}/ (requires audioScope=external-enabled)', ko: '외부 .mp3/.ogg/.wav (audioScope=external-enabled 필요)' }, accentColor: 'green' },
  { id: 'hybrid', label: { en: 'Hybrid', ko: '하이브리드' }, description: { en: 'Procedural SFX + external BGM — bridge mode', ko: '프로시저럴 SFX + 외부 BGM — 브릿지 모드' }, accentColor: 'amber' },
];
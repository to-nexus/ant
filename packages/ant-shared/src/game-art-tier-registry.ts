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
  GameArtTier,
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
 * v10 — genre-neutral art-style archetypes spanning the real game-art
 * taxonomy (production × rendering × thematic) at UI-`visualLanguage`-level
 * breadth. Replaces the v9 genre-tinged 5-set. Each is a single coherent
 * named style + an advisory `supportedPerspectives` (see GAME_ART_CONCEPT_OPTIONS
 * + getGameArtConceptsWithPerspectives). Fantasy-RPG territory is covered by
 * pixelJRPG / paintedFantasy / darkGothic / stylizedReal.
 */
export const GAME_ART_CONCEPT_VARIANTS: readonly GameArtConceptVariant[] = [
  'flatVector',
  'pixelArcade',
  'pixelJRPG',
  'paintedFantasy',
  'celToon',
  'handDrawnStorybook',
  'lowPolyGeo',
  'neonSynth',
  'softCozy',
  'darkGothic',
  'stylizedReal',
] as const;

/**
 * Render dimension. `'2d'` renders with plain Phaser (Graphics / Sprite);
 * `'3d'` layers the `enable3d` extension (three.js + ammo.js) onto the same
 * Phaser host, drawing the world from code-only built-in primitives
 * (box / sphere / ground / …) so no imported model assets are required.
 * `gameEngine` stays `'phaser'` for both — perspective is the sole 2D↔3D
 * signal. `gameArtPerspectiveCandidates` serializes this list to decompose,
 * and the LLM emits `<gameArtTier>...,perspective=2d|3d,...</gameArtTier>`.
 */
export const GAME_ART_PERSPECTIVE_VARIANTS: readonly GameArtPerspectiveVariant[] = [
  '2d',
  '3d',
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

/**
 * Axis → legal-variant whitelist, keyed in GAME_ART_TIER_AXIS_KEYS order.
 * Single owner for per-axis validation (DecisionTagRegistry parse,
 * workspace-config basis validation, per-axis default fill).
 */
export const GAME_ART_AXIS_VARIANTS: Record<GameArtTierAxisKey, readonly string[]> = {
  concept: GAME_ART_CONCEPT_VARIANTS,
  perspective: GAME_ART_PERSPECTIVE_VARIANTS,
  entityCatalog: GAME_ART_ENTITY_CATALOG_VARIANTS,
  motionPattern: GAME_ART_MOTION_PATTERN_VARIANTS,
  particleProfile: GAME_ART_PARTICLE_PROFILE_VARIANTS,
  projectilePolicy: GAME_ART_PROJECTILE_POLICY_VARIANTS,
  audioProfile: GAME_ART_AUDIO_PROFILE_VARIANTS,
};

/**
 * Per-axis whitelist sanitizer for persisted / externally-sourced
 * GameArtTier payloads (e.g. `config.json` → `WorkspaceConfig.basis`).
 * Invalid axis values are dropped (not coerced); returns `undefined` when
 * nothing valid survives.
 */
export function sanitizeGameArtTier(input: unknown): GameArtTier | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const out: Record<string, string> = {};
  for (const key of GAME_ART_TIER_AXIS_KEYS) {
    const v = (input as Record<string, unknown>)[key];
    if (typeof v === 'string' && GAME_ART_AXIS_VARIANTS[key].includes(v)) {
      out[key] = v;
    }
  }
  return Object.keys(out).length > 0 ? (out as GameArtTier) : undefined;
}

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
  { id: 'flatVector', label: { en: 'Flat Vector', ko: '플랫 벡터' }, description: { en: 'Clean flat solid-fill vector shapes, minimal detail (hyper-casual / mobile)', ko: '클린 플랫 솔리드-필 벡터 도형, 최소 디테일 (하이퍼캐주얼 / 모바일)' }, accentColor: 'sky', supportedPerspectives: 'both' },
  { id: 'pixelArcade', label: { en: 'Pixel Arcade', ko: '픽셀 아케이드' }, description: { en: '8-bit limited-palette hard-edge pixel art, stepped animation (retro arcade)', ko: '8비트 제한 팔레트 하드엣지 픽셀아트, 스텝 애니 (레트로 아케이드)' }, accentColor: 'orange', supportedPerspectives: '2d' },
  { id: 'pixelJRPG', label: { en: 'Pixel JRPG', ko: '픽셀 JRPG' }, description: { en: '16-bit lush pixel with parallax + expressive sprites, jewel/earth palette (classic fantasy RPG)', ko: '16비트 lush 픽셀 + 패럴랙스 + 표현적 스프라이트, 주얼/어스 팔레트 (전통 판타지 RPG)' }, accentColor: 'amber', supportedPerspectives: '2d' },
  { id: 'paintedFantasy', label: { en: 'Painted Fantasy', ko: '페인티드 판타지' }, description: { en: 'Hand-painted / illustrated high-fantasy, ornate silhouettes, dramatic light, parchment + serif HUD', ko: '핸드페인티드/일러스트 고판타지, 오네이트 실루엣, 드라마틱 광, 양피지+세리프 HUD' }, accentColor: 'yellow', supportedPerspectives: 'both' },
  { id: 'celToon', label: { en: 'Cel Toon', ko: '셀 툰' }, description: { en: 'Bold ink outlines + flat cel fills (anime / comic / modern JRPG)', ko: '볼드 잉크 아웃라인 + 플랫 셀 필 (애니 / 코믹 / 모던 JRPG)' }, accentColor: 'red', supportedPerspectives: 'both' },
  { id: 'handDrawnStorybook', label: { en: 'Hand-Drawn Storybook', ko: '손그림 스토리북' }, description: { en: 'Watercolor / ink hand-drawn strokes, paper texture, organic wobble (indie / storybook)', ko: '수채/잉크 손그림 스트로크, 종이 텍스처, 유기적 흔들림 (인디 / 동화)' }, accentColor: 'teal', supportedPerspectives: '2d' },
  { id: 'lowPolyGeo', label: { en: 'Low-Poly Geometric', ko: '로우폴리 지오메트릭' }, description: { en: 'Faceted flat-shaded geometric forms (indie 3D via enable3d primitives)', ko: '패싯 플랫셰이드 지오메트릭 폼 (enable3d 프리미티브 기반 인디 3D)' }, accentColor: 'lime', supportedPerspectives: '3d' },
  { id: 'neonSynth', label: { en: 'Neon Synth', ko: '네온 신스' }, description: { en: 'Dark ground + emissive neon glow, high contrast (arcade / cyberpunk / synthwave)', ko: '다크 그라운드 + 이미시브 네온 글로우, 고대비 (아케이드 / 사이버펑크 / 신스웨이브)' }, accentColor: 'violet', supportedPerspectives: 'both' },
  { id: 'softCozy', label: { en: 'Soft Cozy', ko: '소프트 코지' }, description: { en: 'Pastel hues, pillowy rounded volumes, soft light (cozy / casual)', ko: '파스텔 hue, 라운드 pillowy 볼륨, 소프트 광 (코지 / 캐주얼)' }, accentColor: 'pink', supportedPerspectives: 'both' },
  { id: 'darkGothic', label: { en: 'Dark Gothic', ko: '다크 고딕' }, description: { en: 'High-contrast desaturated, dramatic shadow, gothic ink (dark-fantasy / horror)', ko: '고대비 저채도, 드라마틱 그림자, 고딕 잉크 (다크판타지 / 호러)' }, accentColor: 'slate', supportedPerspectives: 'both' },
  { id: 'stylizedReal', label: { en: 'Stylized Realistic', ko: '스타일라이즈드 리얼' }, description: { en: 'Semi-realistic stylized, naturalistic palette + volumetric light (fantasy-realism, primarily a handoff seed)', ko: '세미-리얼리스틱 스타일라이즈드, 자연광+볼류메트릭 (판타지-리얼리즘, 주로 핸드오프 seed)' }, accentColor: 'stone', supportedPerspectives: '3d' },
];

/**
 * Serializes each concept id with its supported render perspective for the
 * decompose detection prompt — twin of visual-tier-registry's
 * `getVisualLanguagesWithModes()`. Produces e.g.
 * `flatVector (both), pixelArcade (2d), lowPolyGeo (3d), …`. The detection
 * prompt uses this to constrain the LLM's `perspective` choice to what the
 * chosen `concept` supports (a `2d`-only concept must not be rendered `3d`).
 */
export function getGameArtConceptsWithPerspectives(): string {
  return GAME_ART_CONCEPT_OPTIONS
    .map(o => `${o.id} (${o.supportedPerspectives ?? 'both'})`)
    .join(', ');
}

export const GAME_ART_PERSPECTIVE_OPTIONS: BasisOption[] = [
  { id: '2d', label: { en: '2D', ko: '2D' }, description: { en: 'Flat 2D camera (top-down / side / iso). Plain Phaser rendering.', ko: '평면 2D 카메라 (탑다운 / 사이드 / 아이소메트릭). 일반 Phaser 렌더링.' }, accentColor: 'blue' },
  { id: '3d', label: { en: '3D', ko: '3D' }, description: { en: '3D scene via Phaser + enable3d. Built-in primitives (box / sphere / ground), no imported assets required.', ko: 'Phaser + enable3d 로 3D 씬. 내장 프리미티브 (박스 / 구 / 지면), 임포트 에셋 불필요.' }, accentColor: 'violet' },
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
  { id: 'fileBased', label: { en: 'File-Based', ko: '파일 기반' }, description: { en: 'External .mp3/.ogg/.wav under assets/game/{sfx,bgm}/ (requires audioScope=external-enabled)', ko: '외부 .mp3/.ogg/.wav (audioScope=external-enabled 필요)' }, accentColor: 'green' },
  { id: 'hybrid', label: { en: 'Hybrid', ko: '하이브리드' }, description: { en: 'Procedural SFX + external BGM — bridge mode', ko: '프로시저럴 SFX + 외부 BGM — 브릿지 모드' }, accentColor: 'amber' },
];
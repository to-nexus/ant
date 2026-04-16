/**
 * Visual Tier Registry — Single Source of Truth
 *
 * Defines the 6-layer visual design policy system:
 *   Layer 1-3 (user-selectable): visualLanguage, surfaceSystem, spatialSystem
 *   Layer 4-6 (auto-derived):    interactionGrammar, componentSemantics, visualHierarchyRules
 *
 * Consumed by both FE (BasisSelector UI) and BE (PromptBuilder, decompose).
 */

import type {
  VisualLanguageVariant,
  SurfaceSystemVariant,
  SpatialSystemVariant,
  InteractionGrammarVariant,
  ComponentSemanticsVariant,
  VisualHierarchyRulesVariant,
  VisualTier,
} from './rac';

import type { BasisOption } from './tech-tier-registry';

// ============================================
// Variant Constants
// ============================================

export const VISUAL_LANGUAGE_VARIANTS: readonly VisualLanguageVariant[] = [
  'modernSaas', 'enterprise', 'fintechPremium', 'devtoolDark', 'minimalNeutral',
  'crispMinimal', 'cleanBright', 'neutralPro', 'warmNatural', 'softClay',
  'bentoModern', 'deepMuted', 'darkLuxury', 'cinematicDark',
  'boldPlayful', 'neoBrutalist', 'editorialBold', 'cyberpunkNeon', 'retroFuture',
  'nexusDS',
] as const;

export const SURFACE_SYSTEM_VARIANTS: readonly SurfaceSystemVariant[] = [
  'solid', 'soft', 'borderedSoft', 'tinted', 'glassLight',
] as const;

export const SPATIAL_SYSTEM_VARIANTS: readonly SpatialSystemVariant[] = [
  'compact8pt', 'balanced8pt', 'airy8pt', 'dense12ptHybrid',
] as const;

export const INTERACTION_GRAMMAR_VARIANTS: readonly InteractionGrammarVariant[] = [
  'restrained', 'subtleProduct', 'calmPremium', 'rawInstant', 'cinematicReveal', 'expressivePlayful',
] as const;

export const COMPONENT_SEMANTICS_VARIANTS: readonly ComponentSemanticsVariant[] = [
  'metricFirst', 'actionGuided', 'contentPreview', 'utilityPanel',
] as const;

export const VISUAL_HIERARCHY_RULES_VARIANTS: readonly VisualHierarchyRulesVariant[] = [
  'controlledFocus', 'taskPriority', 'summaryFirst', 'quietLayered',
] as const;

// ============================================
// UI Options (BasisOption arrays)
// ============================================

export const VISUAL_LANGUAGE_OPTIONS: BasisOption[] = [
  { id: 'modernSaas', label: { en: 'Modern SaaS', ko: 'Modern SaaS' }, description: { en: 'Clean, bright UI with rounded corners and gradients', ko: '라운드 코너와 그라데이션의 밝고 깔끔한 UI' }, accentColor: 'blue', supportedModes: 'both' },
  { id: 'enterprise', label: { en: 'Enterprise', ko: 'Enterprise' }, description: { en: 'Professional, dense UI with sharp edges and structure', ko: '날카로운 엣지와 구조의 프로페셔널 UI' }, accentColor: 'slate', supportedModes: 'both' },
  { id: 'fintechPremium', label: { en: 'Fintech Premium', ko: 'Fintech Premium' }, description: { en: 'Dark luxury with gold and emerald accents', ko: '골드와 에메랄드 악센트의 다크 럭셔리' }, accentColor: 'amber', supportedModes: 'dark' },
  { id: 'devtoolDark', label: { en: 'Developer Tool', ko: 'Developer Tool' }, description: { en: 'Terminal-inspired dark theme with neon accents', ko: '네온 악센트의 터미널 영감 다크 테마' }, accentColor: 'green', supportedModes: 'dark' },
  { id: 'minimalNeutral', label: { en: 'Minimal Neutral', ko: 'Minimal Neutral' }, description: { en: 'Pure white space with subtle gray borders', ko: '미세한 회색 보더의 순백 여백' }, accentColor: 'gray', supportedModes: 'both' },
  { id: 'crispMinimal', label: { en: 'Crisp Minimal', ko: 'Crisp Minimal' }, description: { en: 'Ultra-clean with sharp geometry', ko: '날카로운 기하학의 울트라 클린' }, accentColor: 'gray', supportedModes: 'both' },
  { id: 'cleanBright', label: { en: 'Clean Bright', ko: 'Clean Bright' }, description: { en: 'Airy pastels with ample whitespace', ko: '넉넉한 여백의 밝은 파스텔' }, accentColor: 'sky', supportedModes: 'light' },
  { id: 'neutralPro', label: { en: 'Neutral Pro', ko: 'Neutral Pro' }, description: { en: 'Corporate gray palette, utilitarian focus', ko: '기업용 그레이 팔레트, 실용성 중심' }, accentColor: 'slate', supportedModes: 'both' },
  { id: 'warmNatural', label: { en: 'Warm Natural', ko: 'Warm Natural' }, description: { en: 'Earthy tones with organic textures', ko: '어스 톤과 유기적 텍스처' }, accentColor: 'amber', supportedModes: 'light' },
  { id: 'softClay', label: { en: 'Soft Clay', ko: 'Soft Clay' }, description: { en: 'Rounded 3D shapes with matte pastels', ko: '매트 파스텔의 라운드 3D 셰이프' }, accentColor: 'rose', supportedModes: 'light' },
  { id: 'bentoModern', label: { en: 'Bento Modern', ko: 'Bento Modern' }, description: { en: 'Grid-based card layout, bold type hierarchy', ko: '그리드 카드 레이아웃, 대담한 타이포그래피' }, accentColor: 'indigo', supportedModes: 'both' },
  { id: 'deepMuted', label: { en: 'Deep Muted', ko: 'Deep Muted' }, description: { en: 'Low saturation dark palette, subtle contrast', ko: '저채도 다크 팔레트, 은은한 대비' }, accentColor: 'zinc', supportedModes: 'dark' },
  { id: 'darkLuxury', label: { en: 'Dark Luxury', ko: 'Dark Luxury' }, description: { en: 'Rich blacks with metallic accents', ko: '메탈릭 악센트의 리치 블랙' }, accentColor: 'amber', supportedModes: 'dark' },
  { id: 'cinematicDark', label: { en: 'Cinematic Dark', ko: 'Cinematic Dark' }, description: { en: 'Film-grade gradients with dramatic lighting', ko: '영화급 그라데이션과 드라마틱 라이팅' }, accentColor: 'violet', supportedModes: 'dark' },
  { id: 'boldPlayful', label: { en: 'Bold Playful', ko: 'Bold Playful' }, description: { en: 'Saturated primary colors with playful shapes', ko: '고채도 원색과 플레이풀 셰이프' }, accentColor: 'yellow', supportedModes: 'both' },
  { id: 'neoBrutalist', label: { en: 'Neo Brutalist', ko: 'Neo Brutalist' }, description: { en: 'Raw borders, system fonts, high contrast', ko: '거친 보더, 시스템 폰트, 높은 대비' }, accentColor: 'red', supportedModes: 'both' },
  { id: 'editorialBold', label: { en: 'Editorial Bold', ko: 'Editorial Bold' }, description: { en: 'Magazine-style large type and grids', ko: '매거진 스타일 대형 타이포와 그리드' }, accentColor: 'black', supportedModes: 'light' },
  { id: 'cyberpunkNeon', label: { en: 'Cyberpunk Neon', ko: 'Cyberpunk Neon' }, description: { en: 'Neon glows on dark, sci-fi aesthetic', ko: '다크 배경의 네온 글로우, SF 미학' }, accentColor: 'fuchsia', supportedModes: 'dark' },
  { id: 'retroFuture', label: { en: 'Retro Future', ko: 'Retro Future' }, description: { en: '80s retro meets modern tech', ko: '80년대 레트로와 현대 테크의 만남' }, accentColor: 'orange', supportedModes: 'both' },
  { id: 'nexusDS', label: { en: 'NEXUS Design System', ko: 'NEXUS Design System' }, description: { en: 'Data-driven enterprise UI with dark-first functional minimalism', ko: '다크 퍼스트 기능적 미니멀리즘의 데이터 중심 엔터프라이즈 UI' }, accentColor: 'teal', supportedModes: 'both' },
];

export const SURFACE_SYSTEM_OPTIONS: BasisOption[] = [
  { id: 'solid', label: { en: 'Solid', ko: 'Solid' }, description: { en: 'Flat opaque backgrounds with clear boundaries', ko: '명확한 경계의 불투명 배경' }, accentColor: 'gray' },
  { id: 'soft', label: { en: 'Soft', ko: 'Soft' }, description: { en: 'Subtle shadows and gentle elevation', ko: '미세한 그림자와 부드러운 입체감' }, accentColor: 'blue' },
  { id: 'borderedSoft', label: { en: 'Bordered Soft', ko: 'Bordered Soft' }, description: { en: 'Thin borders with soft inner fill', ko: '얇은 보더와 부드러운 내부 채움' }, accentColor: 'slate' },
  { id: 'tinted', label: { en: 'Tinted', ko: 'Tinted' }, description: { en: 'Color-washed containers with translucent borders', ko: '반투명 보더의 컬러 워시 컨테이너' }, accentColor: 'indigo' },
  { id: 'glassLight', label: { en: 'Glass Light', ko: 'Glass Light' }, description: { en: 'Frosted glass with backdrop blur', ko: '배경 블러의 프로스티드 글래스' }, accentColor: 'sky' },
];

export const SPATIAL_SYSTEM_OPTIONS: BasisOption[] = [
  { id: 'compact8pt', label: { en: 'Compact 8pt', ko: 'Compact 8pt' }, description: { en: 'Tight density for data-heavy interfaces', ko: '데이터 중심 인터페이스를 위한 높은 밀도' }, accentColor: 'orange' },
  { id: 'balanced8pt', label: { en: 'Balanced 8pt', ko: 'Balanced 8pt' }, description: { en: 'Standard spacing rhythm for general use', ko: '범용 표준 간격 리듬' }, accentColor: 'blue' },
  { id: 'airy8pt', label: { en: 'Airy 8pt', ko: 'Airy 8pt' }, description: { en: 'Generous whitespace for breathing room', ko: '여유로운 여백으로 시원한 느낌' }, accentColor: 'teal' },
  { id: 'dense12ptHybrid', label: { en: 'Dense 12pt Hybrid', ko: 'Dense 12pt Hybrid' }, description: { en: 'Mixed density with 12pt base grid', ko: '12pt 기본 그리드의 혼합 밀도' }, accentColor: 'purple' },
];

export const INTERACTION_GRAMMAR_OPTIONS: BasisOption[] = [
  { id: 'restrained', label: { en: 'Restrained', ko: 'Restrained' } },
  { id: 'subtleProduct', label: { en: 'Subtle Product', ko: 'Subtle Product' } },
  { id: 'calmPremium', label: { en: 'Calm Premium', ko: 'Calm Premium' } },
  { id: 'rawInstant', label: { en: 'Raw Instant', ko: 'Raw Instant' } },
  { id: 'cinematicReveal', label: { en: 'Cinematic Reveal', ko: 'Cinematic Reveal' } },
  { id: 'expressivePlayful', label: { en: 'Expressive Playful', ko: 'Expressive Playful' } },
];

export const COMPONENT_SEMANTICS_OPTIONS: BasisOption[] = [
  { id: 'metricFirst', label: { en: 'Metric First', ko: 'Metric First' } },
  { id: 'actionGuided', label: { en: 'Action Guided', ko: 'Action Guided' } },
  { id: 'contentPreview', label: { en: 'Content Preview', ko: 'Content Preview' } },
  { id: 'utilityPanel', label: { en: 'Utility Panel', ko: 'Utility Panel' } },
];

export const VISUAL_HIERARCHY_RULES_OPTIONS: BasisOption[] = [
  { id: 'controlledFocus', label: { en: 'Controlled Focus', ko: 'Controlled Focus' } },
  { id: 'taskPriority', label: { en: 'Task Priority', ko: 'Task Priority' } },
  { id: 'summaryFirst', label: { en: 'Summary First', ko: 'Summary First' } },
  { id: 'quietLayered', label: { en: 'Quiet Layered', ko: 'Quiet Layered' } },
];

// ============================================
// Auto-derive Functions (pure, shared FE+BE)
// ============================================

const INTERACTION_GRAMMAR_MAP: Record<VisualLanguageVariant, InteractionGrammarVariant> = {
  modernSaas: 'subtleProduct',
  enterprise: 'restrained',
  fintechPremium: 'calmPremium',
  devtoolDark: 'restrained',
  minimalNeutral: 'calmPremium',
  crispMinimal: 'restrained',
  cleanBright: 'subtleProduct',
  neutralPro: 'restrained',
  warmNatural: 'calmPremium',
  softClay: 'expressivePlayful',
  bentoModern: 'subtleProduct',
  deepMuted: 'calmPremium',
  darkLuxury: 'cinematicReveal',
  cinematicDark: 'cinematicReveal',
  boldPlayful: 'expressivePlayful',
  neoBrutalist: 'rawInstant',
  editorialBold: 'rawInstant',
  cyberpunkNeon: 'cinematicReveal',
  retroFuture: 'expressivePlayful',
  nexusDS: 'restrained',
};

export function deriveInteractionGrammar(
  visualLanguage: VisualLanguageVariant,
): InteractionGrammarVariant {
  return INTERACTION_GRAMMAR_MAP[visualLanguage] ?? 'subtleProduct';
}

const VH_MAP: Record<string, VisualHierarchyRulesVariant> = {
  'modernSaas|balanced8pt': 'controlledFocus',
  'modernSaas|airy8pt': 'summaryFirst',
  'modernSaas|compact8pt': 'controlledFocus',
  'modernSaas|dense12ptHybrid': 'controlledFocus',
  'enterprise|compact8pt': 'taskPriority',
  'enterprise|dense12ptHybrid': 'taskPriority',
  'enterprise|balanced8pt': 'taskPriority',
  'enterprise|airy8pt': 'taskPriority',
  'fintechPremium|balanced8pt': 'summaryFirst',
  'fintechPremium|airy8pt': 'quietLayered',
  'fintechPremium|compact8pt': 'summaryFirst',
  'fintechPremium|dense12ptHybrid': 'summaryFirst',
  'devtoolDark|compact8pt': 'controlledFocus',
  'devtoolDark|dense12ptHybrid': 'controlledFocus',
  'devtoolDark|balanced8pt': 'controlledFocus',
  'devtoolDark|airy8pt': 'controlledFocus',
  'minimalNeutral|airy8pt': 'quietLayered',
  'minimalNeutral|balanced8pt': 'controlledFocus',
  'minimalNeutral|compact8pt': 'quietLayered',
  'minimalNeutral|dense12ptHybrid': 'controlledFocus',
  'crispMinimal|compact8pt': 'controlledFocus',
  'crispMinimal|balanced8pt': 'controlledFocus',
  'crispMinimal|airy8pt': 'quietLayered',
  'crispMinimal|dense12ptHybrid': 'controlledFocus',
  'cleanBright|compact8pt': 'controlledFocus',
  'cleanBright|balanced8pt': 'summaryFirst',
  'cleanBright|airy8pt': 'summaryFirst',
  'cleanBright|dense12ptHybrid': 'controlledFocus',
  'neutralPro|compact8pt': 'taskPriority',
  'neutralPro|balanced8pt': 'taskPriority',
  'neutralPro|airy8pt': 'taskPriority',
  'neutralPro|dense12ptHybrid': 'taskPriority',
  'warmNatural|compact8pt': 'summaryFirst',
  'warmNatural|balanced8pt': 'summaryFirst',
  'warmNatural|airy8pt': 'quietLayered',
  'warmNatural|dense12ptHybrid': 'summaryFirst',
  'softClay|compact8pt': 'controlledFocus',
  'softClay|balanced8pt': 'summaryFirst',
  'softClay|airy8pt': 'quietLayered',
  'softClay|dense12ptHybrid': 'controlledFocus',
  'bentoModern|compact8pt': 'controlledFocus',
  'bentoModern|balanced8pt': 'controlledFocus',
  'bentoModern|airy8pt': 'summaryFirst',
  'bentoModern|dense12ptHybrid': 'controlledFocus',
  'deepMuted|compact8pt': 'quietLayered',
  'deepMuted|balanced8pt': 'quietLayered',
  'deepMuted|airy8pt': 'quietLayered',
  'deepMuted|dense12ptHybrid': 'quietLayered',
  'darkLuxury|compact8pt': 'summaryFirst',
  'darkLuxury|balanced8pt': 'summaryFirst',
  'darkLuxury|airy8pt': 'quietLayered',
  'darkLuxury|dense12ptHybrid': 'summaryFirst',
  'cinematicDark|compact8pt': 'controlledFocus',
  'cinematicDark|balanced8pt': 'controlledFocus',
  'cinematicDark|airy8pt': 'summaryFirst',
  'cinematicDark|dense12ptHybrid': 'controlledFocus',
  'boldPlayful|compact8pt': 'controlledFocus',
  'boldPlayful|balanced8pt': 'controlledFocus',
  'boldPlayful|airy8pt': 'summaryFirst',
  'boldPlayful|dense12ptHybrid': 'controlledFocus',
  'neoBrutalist|compact8pt': 'taskPriority',
  'neoBrutalist|balanced8pt': 'taskPriority',
  'neoBrutalist|airy8pt': 'taskPriority',
  'neoBrutalist|dense12ptHybrid': 'taskPriority',
  'editorialBold|compact8pt': 'controlledFocus',
  'editorialBold|balanced8pt': 'summaryFirst',
  'editorialBold|airy8pt': 'summaryFirst',
  'editorialBold|dense12ptHybrid': 'controlledFocus',
  'cyberpunkNeon|compact8pt': 'controlledFocus',
  'cyberpunkNeon|balanced8pt': 'controlledFocus',
  'cyberpunkNeon|airy8pt': 'controlledFocus',
  'cyberpunkNeon|dense12ptHybrid': 'controlledFocus',
  'retroFuture|compact8pt': 'controlledFocus',
  'retroFuture|balanced8pt': 'summaryFirst',
  'retroFuture|airy8pt': 'summaryFirst',
  'retroFuture|dense12ptHybrid': 'controlledFocus',
  'nexusDS|compact8pt': 'taskPriority',
  'nexusDS|balanced8pt': 'taskPriority',
  'nexusDS|airy8pt': 'summaryFirst',
  'nexusDS|dense12ptHybrid': 'taskPriority',
};

export function deriveVisualHierarchyRules(
  visualLanguage: VisualLanguageVariant,
  spatialSystem: SpatialSystemVariant,
): VisualHierarchyRulesVariant {
  return VH_MAP[`${visualLanguage}|${spatialSystem}`] ?? 'controlledFocus';
}

const CS_KEYWORDS: [RegExp, ComponentSemanticsVariant][] = [
  [/dashboard|analytics|monitoring|metric|kpi/i, 'metricFirst'],
  [/onboarding|setup|wizard|action|admin/i, 'actionGuided'],
  [/catalog|resource|content|list|browse|gallery/i, 'contentPreview'],
  [/settings|config|internal.?tool|operations|utility/i, 'utilityPanel'],
];

export function deriveComponentSemantics(
  screenContext: string,
): ComponentSemanticsVariant {
  for (const [pattern, variant] of CS_KEYWORDS) {
    if (pattern.test(screenContext)) return variant;
  }
  return 'metricFirst';
}

// ============================================
// Full Resolution (merge user + auto-detect + derive)
// ============================================

export function resolveVisualTier(
  userSelection?: Partial<VisualTier>,
  autoDetected?: Partial<VisualTier>,
  screenContext?: string,
): Partial<VisualTier> {
  const visualLanguage = userSelection?.visualLanguage ?? autoDetected?.visualLanguage;
  const surfaceSystem = userSelection?.surfaceSystem ?? autoDetected?.surfaceSystem;
  const spatialSystem = userSelection?.spatialSystem ?? autoDetected?.spatialSystem;

  const interactionGrammar = visualLanguage
    ? deriveInteractionGrammar(visualLanguage)
    : undefined;
  const visualHierarchyRules = (visualLanguage && spatialSystem)
    ? deriveVisualHierarchyRules(visualLanguage, spatialSystem)
    : undefined;
  const componentSemantics = screenContext
    ? deriveComponentSemantics(screenContext)
    : undefined;

  return {
    visualLanguage,
    surfaceSystem,
    spatialSystem,
    interactionGrammar,
    visualHierarchyRules,
    componentSemantics,
  };
}

// ============================================
// Template Path Functions
// ============================================

export const VISUAL_TIER_LAYER_KEYS = [
  'visualLanguage', 'surfaceSystem', 'spatialSystem',
  'interactionGrammar', 'componentSemantics', 'visualHierarchyRules',
] as const;

export const VISUAL_TIER_TEMPLATE_PATHS = {
  preamble: () => 'basis/visualTier/_preamble',
  jobPreamble: (job: string) => `jobs/${job}/basis/visualTier/_preamble`,
  visualLanguage: (v: string) => `basis/visualTier/visualLanguage/${v}`,
  surfaceSystem: (v: string) => `basis/visualTier/surfaceSystem/${v}`,
  spatialSystem: (v: string) => `basis/visualTier/spatialSystem/${v}`,
  interactionGrammar: (v: string) => `basis/visualTier/interactionGrammar/${v}`,
  componentSemantics: (v: string) => `basis/visualTier/componentSemantics/${v}`,
  visualHierarchyRules: (v: string) => `basis/visualTier/visualHierarchyRules/${v}`,
} as const;

export function getVisualLanguagesWithModes(): string {
  return VISUAL_LANGUAGE_OPTIONS
    .map(o => `${o.id} (${o.supportedModes ?? 'both'})`)
    .join(', ');
}

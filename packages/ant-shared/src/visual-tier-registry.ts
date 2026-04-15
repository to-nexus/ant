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
] as const;

export const SURFACE_SYSTEM_VARIANTS: readonly SurfaceSystemVariant[] = [
  'solid', 'soft', 'borderedSoft', 'tinted', 'glassLight',
] as const;

export const SPATIAL_SYSTEM_VARIANTS: readonly SpatialSystemVariant[] = [
  'compact8pt', 'balanced8pt', 'airy8pt', 'dense12ptHybrid',
] as const;

export const INTERACTION_GRAMMAR_VARIANTS: readonly InteractionGrammarVariant[] = [
  'restrained', 'subtleProduct', 'calmPremium',
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
  { id: 'modernSaas', label: { en: 'Modern SaaS', ko: 'Modern SaaS' }, description: { en: 'Clean, bright UI with rounded corners and gradients', ko: '라운드 코너와 그라데이션의 밝고 깔끔한 UI' }, accentColor: 'blue' },
  { id: 'enterprise', label: { en: 'Enterprise', ko: 'Enterprise' }, description: { en: 'Professional, dense UI with sharp edges and structure', ko: '날카로운 엣지와 구조의 프로페셔널 UI' }, accentColor: 'slate' },
  { id: 'fintechPremium', label: { en: 'Fintech Premium', ko: 'Fintech Premium' }, description: { en: 'Dark luxury with gold and emerald accents', ko: '골드와 에메랄드 악센트의 다크 럭셔리' }, accentColor: 'amber' },
  { id: 'devtoolDark', label: { en: 'Developer Tool', ko: 'Developer Tool' }, description: { en: 'Terminal-inspired dark theme with neon accents', ko: '네온 악센트의 터미널 영감 다크 테마' }, accentColor: 'green' },
  { id: 'minimalNeutral', label: { en: 'Minimal Neutral', ko: 'Minimal Neutral' }, description: { en: 'Pure white space with subtle gray borders', ko: '미세한 회색 보더의 순백 여백' }, accentColor: 'gray' },
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

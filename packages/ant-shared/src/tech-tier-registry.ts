/**
 * Tech Tier Registry — Single Source of Truth
 *
 * TECH_TIER_CONSTRAINTS is the single source of truth for the
 * stack → language → framework dependency chain.
 *
 * Key concepts:
 *   - SupportedLanguage: base language selection (typescript, go)
 *   - TechTierKey: individual tier slot (frontend | backend)
 *   - SupportedStack: project structure (frontend, backend, fullstack)
 *   - TECH_TIER_CONSTRAINTS: stack→language→framework chain (SSOT)
 *   - LanguageVariant: (language, stack) → self-contained prompt template
 *   - Template path functions: ensure registry ↔ template file 1:1 mapping
 */

// ============================================
// Language
// ============================================

export const SUPPORTED_LANGUAGES = ['typescript', 'go'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

// ============================================
// Stack + TechTierKey
// ============================================

export const SUPPORTED_STACKS = ['frontend', 'backend', 'fullstack'] as const;
export type SupportedStack = (typeof SUPPORTED_STACKS)[number];

/** Individual tier slot — fullstack is a project structure, not an individual tier */
export type TechTierKey = Exclude<SupportedStack, 'fullstack'>;

// ============================================
// Language Variant
// ============================================

export type LanguageVariant = 'typescript-browser' | 'typescript-node' | 'go';

export const LANGUAGE_VARIANT_MAP: Record<
  SupportedLanguage,
  Partial<Record<SupportedStack, LanguageVariant | LanguageVariant[]>>
> = {
  typescript: {
    frontend: 'typescript-browser',
    backend: 'typescript-node',
    fullstack: ['typescript-browser', 'typescript-node'],
  },
  go: {
    backend: 'go',
  },
};

/**
 * Resolve (language, stack) → ordered list of language variants to inject.
 * When stack is missing, falls back to the single most common variant.
 */
export function resolveLanguageVariants(
  lang: SupportedLanguage,
  stack?: SupportedStack,
): LanguageVariant[] {
  if (!stack) return [lang === 'go' ? 'go' : 'typescript-browser'];
  const result = LANGUAGE_VARIANT_MAP[lang]?.[stack];
  if (!result) return [lang === 'go' ? 'go' : 'typescript-browser'];
  return Array.isArray(result) ? [...result] : [result];
}

// ============================================
// TECH_TIER_CONSTRAINTS — SSOT for stack→language→framework chain
//
// Selection order: stack → language → framework
// When stack is selected, language choices narrow;
// when language is selected, framework choices narrow.
// ============================================

export const TECH_TIER_CONSTRAINTS: Record<TechTierKey, {
  readonly languages: readonly SupportedLanguage[];
  readonly frameworks: Partial<Record<SupportedLanguage, readonly string[]>>;
}> = {
  frontend: {
    languages: ['typescript'],
    frameworks: { typescript: ['react', 'nextjs', 'react-native'] },
  },
  backend: {
    languages: ['typescript', 'go'],
    frameworks: { typescript: ['nestjs'], go: ['gin'] },
  },
};

// ============================================
// Derived helpers (computed from TECH_TIER_CONSTRAINTS)
// ============================================

export function getValidLanguages(tierKey: TechTierKey): SupportedLanguage[] {
  return [...TECH_TIER_CONSTRAINTS[tierKey].languages];
}

export function getValidFrameworks(tierKey: TechTierKey, lang: SupportedLanguage): string[] {
  const constraints = TECH_TIER_CONSTRAINTS[tierKey];
  if (!constraints) return [];
  const fws = constraints.frameworks;
  return [...(fws[lang as keyof typeof fws] ?? [])];
}

/** fullstack = intersection of frontend ∩ backend languages */
export function getFullstackLanguages(): SupportedLanguage[] {
  const fe = new Set<SupportedLanguage>(TECH_TIER_CONSTRAINTS.frontend.languages);
  return [...TECH_TIER_CONSTRAINTS.backend.languages].filter(l => fe.has(l));
}

// ============================================
// FRAMEWORK_LABELS — UI label SSOT
// ============================================

export const FRAMEWORK_LABELS: Record<string, { en: string; ko: string }> = {
  react:          { en: 'React',        ko: 'React' },
  nextjs:         { en: 'Next.js',      ko: 'Next.js' },
  'react-native': { en: 'React Native', ko: 'React Native' },
  nestjs:         { en: 'NestJS',       ko: 'NestJS' },
  gin:            { en: 'Gin',          ko: 'Gin' },
};

// ============================================
// Validity Matrix (derived from TECH_TIER_CONSTRAINTS)
// ============================================

export const VALID_LANGUAGES_BY_STACK: Record<SupportedStack, readonly SupportedLanguage[]> = {
  frontend:  TECH_TIER_CONSTRAINTS.frontend.languages,
  backend:   TECH_TIER_CONSTRAINTS.backend.languages,
  fullstack: getFullstackLanguages(),
};

export const VALID_STACKS_BY_LANGUAGE: Record<SupportedLanguage, readonly SupportedStack[]> = {
  typescript: ['frontend', 'backend', 'fullstack'],
  go: ['backend'],
};

export function isValidLanguageStackCombo(
  lang: SupportedLanguage,
  stack: SupportedStack,
): boolean {
  return (VALID_STACKS_BY_LANGUAGE[lang] as readonly string[]).includes(stack);
}

// ============================================
// Framework (keyed by language variant)
// Framework is OPTIONAL — not selecting one is a valid choice.
//
// Semantics:
//   undefined → auto-detect (decompose infers from codebase)
//   'none'    → explicitly no framework (blocks auto-detect override)
//   'react'   → explicit framework selection
// ============================================

export const FRAMEWORK_NONE = 'none' as const;

export const SUPPORTED_FRAMEWORKS = {
  'typescript-browser': ['react', 'nextjs', 'react-native'],
  'typescript-node': ['nestjs'],
  'go': ['gin'],
} as const satisfies Record<LanguageVariant, readonly string[]>;

// ============================================
// Template Path Functions
// ============================================

/**
 * Language base template mapping.
 * TypeScript has a shared _typescript-common partial; Go is self-contained.
 * Used by buildBasisSection to inject language base exactly once before variants.
 */
export const LANGUAGE_BASE_TEMPLATE: Record<SupportedLanguage, string | null> = {
  typescript: 'basis/techTier/language/_typescript-common',
  go: 'basis/techTier/language/go',
};

export const TECH_TIER_TEMPLATE_PATHS = {
  languageBase: (lang: SupportedLanguage) => LANGUAGE_BASE_TEMPLATE[lang],
  stack: (stack: SupportedStack) =>
    `basis/techTier/stack/${stack}`,
  setup: (lang: SupportedLanguage, file: 'config' | 'constraints') =>
    `jobs/code/nodes/execute/basis/techTier/${lang}/setup/${file}`,
  jobLanguageVariant: (job: string, variant: LanguageVariant) =>
    `jobs/${job}/basis/techTier/language/${variant}`,
  jobFramework: (job: string, fw: string) =>
    `jobs/${job}/basis/techTier/framework/${fw}`,
  jobDomain: (job: string, domain: string) =>
    `jobs/${job}/basis/domain/${domain}`,
} as const;

// ============================================
// UI Options (BasisOption arrays)
// ============================================

export interface BasisOption {
  id: string;
  label: { en: string; ko: string };
  description?: { en: string; ko: string };
  icon?: string;
  accentColor?: string;
  supportedModes?: 'light' | 'dark' | 'both';
}

export const STACK_OPTIONS: BasisOption[] = [
  { id: 'frontend', label: { en: 'Frontend', ko: 'Frontend' }, description: { en: 'Client-side web or mobile application', ko: '클라이언트 웹 또는 모바일 앱' }, icon: 'monitor', accentColor: 'blue' },
  { id: 'backend', label: { en: 'Backend', ko: 'Backend' }, description: { en: 'Server-side API and business logic', ko: '서버 사이드 API 및 비즈니스 로직' }, icon: 'server', accentColor: 'emerald' },
  { id: 'fullstack', label: { en: 'Fullstack', ko: 'Fullstack' }, description: { en: 'Both frontend and backend together', ko: '프론트엔드와 백엔드 통합' }, icon: 'layers', accentColor: 'violet' },
];

export const TECH_TIER_LANGUAGES: BasisOption[] = [
  { id: 'typescript', label: { en: 'TypeScript', ko: 'TypeScript' }, description: { en: 'Type-safe JavaScript for scalable applications', ko: '확장 가능한 앱을 위한 타입 안전 JavaScript' }, icon: 'typescript', accentColor: 'blue' },
  { id: 'go', label: { en: 'Go', ko: 'Go' }, description: { en: 'Fast, efficient language for cloud-native services', ko: '클라우드 네이티브 서비스를 위한 고성능 언어' }, icon: 'go', accentColor: 'cyan' },
];

export const VISUAL_TIER_DESIGN_SYSTEMS: BasisOption[] = [];

export const FRAMEWORK_OPTIONS_META: Record<string, Omit<BasisOption, 'id' | 'label'>> = {
  react: { description: { en: 'Component-driven SPA with virtual DOM', ko: '가상 DOM 기반 컴포넌트 SPA' }, icon: 'react', accentColor: 'cyan' },
  nextjs: { description: { en: 'Full-stack React with SSR and file-based routing', ko: 'SSR과 파일 기반 라우팅의 풀스택 React' }, icon: 'nextjs', accentColor: 'gray' },
  'react-native': { description: { en: 'Cross-platform mobile apps with React', ko: 'React 기반 크로스 플랫폼 모바일 앱' }, icon: 'react-native', accentColor: 'cyan' },
  nestjs: { description: { en: 'Enterprise Node.js framework with decorators', ko: '데코레이터 기반 엔터프라이즈 Node.js 프레임워크' }, icon: 'nestjs', accentColor: 'red' },
  gin: { description: { en: 'High-performance HTTP framework for Go', ko: 'Go용 고성능 HTTP 프레임워크' }, icon: 'gin', accentColor: 'blue' },
};

/** UI helper: (tierKey, language) → selectable framework options */
export function getFrameworkOptions(
  tierKey: TechTierKey,
  lang: SupportedLanguage,
): BasisOption[] {
  return getValidFrameworks(tierKey, lang).map(fw => ({
    id: fw,
    label: FRAMEWORK_LABELS[fw] ?? { en: fw, ko: fw },
    ...FRAMEWORK_OPTIONS_META[fw],
  }));
}

import type { ComponentType } from 'react';
import { Settings2, Palette, Brush, Gamepad2, type LucideProps } from 'lucide-react';
import type { BasisSlotConfig } from '@ant/shared';
import type { TierKey, WizardStepDef, WizardTierTabItem } from './types';

/**
 * Single source of truth for wizard tiers.
 *
 * Adding a new tier means:
 *   1. extend `TierKey` in `types.ts`,
 *   2. append one entry here,
 *   3. (if the tier carries runtime gating beyond `isConfigured`, e.g.
 *      Visual Tier's stack/uiDoc gate) extend the runtime gate inside
 *      `useBasisWizard`.
 *
 * Everything that previously lived as a hardcoded `'techTier'`/`'visualTier'`
 * literal — labels, ordering, slot predicate, tab icon/colors, even the
 * "what should the wizard land on?" decision — is derived from this registry.
 */
export interface TierDescriptor {
  id: TierKey;
  label: { en: string; ko: string };
  description: { en: string; ko: string };
  /** Static predicate: is this tier even declared on the slot? Runtime
   * gating that depends on live wizard state (e.g. Visual Tier's
   * backend-stack / hasUiDoc suppressors) is layered on top inside
   * `useBasisWizard` via the matrix predicate `isTierActive`. */
  isConfigured: (slot: BasisSlotConfig) => boolean;
  icon: ComponentType<LucideProps>;
  iconBg: string;
  iconColor: string;
}

export const TIER_REGISTRY: readonly TierDescriptor[] = [
  {
    id: 'techTier',
    label: { en: 'Tech Tier', ko: '기술 티어' },
    description: { en: 'Stack, language, framework, and game engine', ko: '스택, 언어, 프레임워크, 게임 엔진' },
    isConfigured: (slot) => Boolean(slot.tiers?.includes('techTier')),
    icon: Settings2,
    iconBg: 'bg-[color:var(--bg-surface-2)]',
    iconColor: 'text-[color:var(--violet-500)]',
  },
  {
    id: 'visualTier',
    label: { en: 'Visual Tier', ko: '비주얼 티어' },
    description: { en: 'Design language and surface style', ko: '디자인 언어와 서피스 스타일' },
    isConfigured: (slot) => Boolean(slot.tiers?.includes('visualTier')),
    icon: Palette,
    iconBg: 'bg-[color:var(--bg-surface-2)]',
    iconColor: 'text-[color:var(--pink-500)]',
  },
  {
    id: 'gameArtTier',
    label: { en: 'Game Art Tier', ko: '게임 아트 티어' },
    description: { en: 'Engine-internal art (concept, perspective, motion, sfx) — game domain only', ko: '엔진 내부 아트 (컨셉, 시점, 모션, SFX) — 게임 도메인 전용' },
    isConfigured: (slot) => Boolean(slot.tiers?.includes('gameArtTier')),
    icon: Brush,
    iconBg: 'bg-[color:var(--bg-surface-2)]',
    iconColor: 'text-[color:var(--amber-500)]',
  },
  {
    id: 'gameContentTier',
    label: { en: 'Game Content', ko: '게임 콘텐츠' },
    description: { en: 'Genre and core loop pattern', ko: '장르와 코어 루프 패턴' },
    isConfigured: (slot) => Boolean(slot.tiers?.includes('gameContentTier')),
    icon: Gamepad2,
    iconBg: 'bg-[color:var(--bg-surface-2)]',
    iconColor: 'text-[color:var(--emerald-500)]',
  },
];

const TIER_INDEX: ReadonlyMap<TierKey, TierDescriptor> = new Map(
  TIER_REGISTRY.map((t) => [t.id, t]),
);

export function getTierDescriptor(tier: TierKey): TierDescriptor {
  const found = TIER_INDEX.get(tier);
  if (!found) throw new Error(`Unknown tier key: ${tier}`);
  return found;
}

/** Tiers statically configured for this slot, in registry order. */
export function listConfiguredTiers(slot: BasisSlotConfig): TierKey[] {
  return TIER_REGISTRY.filter((t) => t.isConfigured(slot)).map((t) => t.id);
}

/**
 * Where should the wizard land on mount? Honors `requested` when it points
 * at a tier that's actually configured for the slot; otherwise falls back to
 * the first configured tier (registry order). The final fallback to
 * `TIER_REGISTRY[0].id` only fires when the slot has no configured tier at
 * all — which the caller (BasisWizard) prevents by not mounting in that case.
 */
export function pickInitialTier(
  slot: BasisSlotConfig,
  requested?: TierKey,
): TierKey {
  const configured = listConfiguredTiers(slot);
  if (requested && configured.includes(requested)) return requested;
  return configured[0] ?? TIER_REGISTRY[0].id;
}

/** Backwards-compatible derived export. Prefer `TIER_REGISTRY` for new code. */
export const TIER_TAB_ITEMS: WizardTierTabItem[] = TIER_REGISTRY.map(
  ({ id, label, description }) => ({ id, label, description }),
);

export const TECH_STEPS: WizardStepDef[] = [
  {
    id: 'stack',
    tierKey: 'techTier',
    layerKey: 'stack',
    title: { en: 'Stack', ko: '스택' },
    description: { en: 'Choose the platform target for your project', ko: '프로젝트의 플랫폼 대상을 선택하세요' },
  },
  {
    id: 'language',
    tierKey: 'techTier',
    layerKey: 'language',
    title: { en: 'Language', ko: '언어' },
    description: { en: 'Select the primary programming language', ko: '주요 프로그래밍 언어를 선택하세요' },
  },
  {
    id: 'framework',
    tierKey: 'techTier',
    layerKey: 'framework',
    title: { en: 'Framework', ko: '프레임워크' },
    description: { en: 'Pick the framework that shapes your app structure', ko: '앱 구조를 결정할 프레임워크를 선택하세요' },
  },
];

export const FULLSTACK_STEPS: WizardStepDef[] = [
  {
    id: 'fe-language',
    tierKey: 'techTier',
    layerKey: 'feLanguage',
    title: { en: 'FE Language', ko: 'FE 언어' },
    description: { en: 'Select the frontend programming language', ko: '프론트엔드 프로그래밍 언어를 선택하세요' },
    group: 'fe',
  },
  {
    id: 'fe-framework',
    tierKey: 'techTier',
    layerKey: 'feFramework',
    title: { en: 'FE Framework', ko: 'FE 프레임워크' },
    description: { en: 'Pick the frontend framework', ko: '프론트엔드 프레임워크를 선택하세요' },
    group: 'fe',
  },
  {
    id: 'be-language',
    tierKey: 'techTier',
    layerKey: 'beLanguage',
    title: { en: 'BE Language', ko: 'BE 언어' },
    description: { en: 'Select the backend programming language', ko: '백엔드 프로그래밍 언어를 선택하세요' },
    group: 'be',
  },
  {
    id: 'be-framework',
    tierKey: 'techTier',
    layerKey: 'beFramework',
    title: { en: 'BE Framework', ko: 'BE 프레임워크' },
    description: { en: 'Pick the backend framework', ko: '백엔드 프레임워크를 선택하세요' },
    group: 'be',
  },
];

export const VISUAL_STEPS: WizardStepDef[] = [
  {
    id: 'visualLanguage',
    tierKey: 'visualTier',
    layerKey: 'visualLanguage',
    title: { en: 'Visual Language', ko: '비주얼 언어' },
    description: { en: 'Define the overall design tone and personality', ko: '전체적인 디자인 톤과 개성을 정의하세요' },
  },
  {
    id: 'surfaceSystem',
    tierKey: 'visualTier',
    layerKey: 'surfaceSystem',
    title: { en: 'Surface System', ko: '서피스 시스템' },
    description: { en: 'Choose how cards, panels, and containers look', ko: '카드, 패널, 컨테이너의 시각적 스타일을 선택하세요' },
  },
];

export const AUTO_DETECT_OPTION = {
  id: '__auto__',
  label: { en: 'Auto-detect', ko: '자동 감지' },
  description: { en: 'Let the system analyze and decide', ko: '시스템이 분석 후 자동으로 결정합니다' },
  icon: 'auto',
  accentColor: 'gray',
};

// Aurora token-driven palette. Hues without exact Aurora token map to the
// nearest available hue (purple→violet, sky→blue, indigo→blue, teal→emerald,
// green→emerald, slate→gray, orange→amber, red→pink). Keys are preserved so
// every existing accent lookup in VariantCard / VariantCardGrid resolves.
export const ACCENT_COLORS: Record<string, { ring: string; bg: string; text: string }> = {
  blue:    { ring: 'ring-[color:var(--blue-400)]',    bg: 'bg-[color:var(--blue-50)]',    text: 'text-[color:var(--blue-600)]' },
  emerald: { ring: 'ring-[color:var(--emerald-400)]', bg: 'bg-[color:var(--emerald-50)]', text: 'text-[color:var(--emerald-600)]' },
  violet:  { ring: 'ring-[color:var(--violet-400)]',  bg: 'bg-[color:var(--violet-50)]',  text: 'text-[color:var(--violet-600)]' },
  cyan:    { ring: 'ring-[color:var(--cyan-400)]',    bg: 'bg-[color:var(--cyan-50)]',    text: 'text-[color:var(--cyan-600)]' },
  gray:    { ring: 'ring-[color:var(--border-3)]',    bg: 'bg-[color:var(--bg-surface-2)]', text: 'text-[color:var(--text-2)]' },
  red:     { ring: 'ring-[color:var(--pink-400)]',    bg: 'bg-[color:var(--pink-50)]',    text: 'text-[color:var(--pink-600)]' },
  amber:   { ring: 'ring-[color:var(--amber-400)]',   bg: 'bg-[color:var(--amber-50)]',   text: 'text-[color:var(--amber-600)]' },
  green:   { ring: 'ring-[color:var(--emerald-400)]', bg: 'bg-[color:var(--emerald-50)]', text: 'text-[color:var(--emerald-600)]' },
  slate:   { ring: 'ring-[color:var(--border-3)]',    bg: 'bg-[color:var(--bg-surface-2)]', text: 'text-[color:var(--text-2)]' },
  indigo:  { ring: 'ring-[color:var(--blue-400)]',    bg: 'bg-[color:var(--blue-50)]',    text: 'text-[color:var(--blue-600)]' },
  sky:     { ring: 'ring-[color:var(--blue-400)]',    bg: 'bg-[color:var(--blue-50)]',    text: 'text-[color:var(--blue-600)]' },
  orange:  { ring: 'ring-[color:var(--amber-400)]',   bg: 'bg-[color:var(--amber-50)]',   text: 'text-[color:var(--amber-600)]' },
  teal:    { ring: 'ring-[color:var(--emerald-400)]', bg: 'bg-[color:var(--emerald-50)]', text: 'text-[color:var(--emerald-600)]' },
  purple:  { ring: 'ring-[color:var(--violet-400)]',  bg: 'bg-[color:var(--violet-50)]',  text: 'text-[color:var(--violet-600)]' },
};

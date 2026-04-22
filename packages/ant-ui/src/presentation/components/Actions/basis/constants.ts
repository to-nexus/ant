import type { WizardStepDef, WizardTierTabItem } from './types';

export const TIER_TAB_ITEMS: WizardTierTabItem[] = [
  {
    id: 'techTier',
    label: { en: 'Tech Tier', ko: '기술 티어' },
    description: { en: 'Stack, language, and framework', ko: '스택, 언어, 프레임워크' },
  },
  {
    id: 'visualTier',
    label: { en: 'Visual Tier', ko: '비주얼 티어' },
    description: { en: 'Design language and surface style', ko: '디자인 언어와 서피스 스타일' },
  },
];

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

export const ACCENT_COLORS: Record<string, { ring: string; bg: string; text: string }> = {
  blue: { ring: 'ring-blue-400', bg: 'bg-blue-50 dark:bg-blue-950/30', text: 'text-blue-600 dark:text-blue-400' },
  emerald: { ring: 'ring-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-950/30', text: 'text-emerald-600 dark:text-emerald-400' },
  violet: { ring: 'ring-violet-400', bg: 'bg-violet-50 dark:bg-violet-950/30', text: 'text-violet-600 dark:text-violet-400' },
  cyan: { ring: 'ring-cyan-400', bg: 'bg-cyan-50 dark:bg-cyan-950/30', text: 'text-cyan-600 dark:text-cyan-400' },
  gray: { ring: 'ring-gray-400', bg: 'bg-gray-50 dark:bg-gray-800/50', text: 'text-gray-600 dark:text-gray-400' },
  red: { ring: 'ring-red-400', bg: 'bg-red-50 dark:bg-red-950/30', text: 'text-red-600 dark:text-red-400' },
  amber: { ring: 'ring-amber-400', bg: 'bg-amber-50 dark:bg-amber-950/30', text: 'text-amber-600 dark:text-amber-400' },
  green: { ring: 'ring-green-400', bg: 'bg-green-50 dark:bg-green-950/30', text: 'text-green-600 dark:text-green-400' },
  slate: { ring: 'ring-slate-400', bg: 'bg-slate-50 dark:bg-slate-800/50', text: 'text-slate-600 dark:text-slate-400' },
  indigo: { ring: 'ring-indigo-400', bg: 'bg-indigo-50 dark:bg-indigo-950/30', text: 'text-indigo-600 dark:text-indigo-400' },
  sky: { ring: 'ring-sky-400', bg: 'bg-sky-50 dark:bg-sky-950/30', text: 'text-sky-600 dark:text-sky-400' },
  orange: { ring: 'ring-orange-400', bg: 'bg-orange-50 dark:bg-orange-950/30', text: 'text-orange-600 dark:text-orange-400' },
  teal: { ring: 'ring-teal-400', bg: 'bg-teal-50 dark:bg-teal-950/30', text: 'text-teal-600 dark:text-teal-400' },
  purple: { ring: 'ring-purple-400', bg: 'bg-purple-50 dark:bg-purple-950/30', text: 'text-purple-600 dark:text-purple-400' },
};

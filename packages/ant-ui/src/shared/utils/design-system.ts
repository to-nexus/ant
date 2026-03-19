/**
 * Design System Utilities
 * Centralized theming utilities for consistent dark mode support
 */

// Background Colors
export const bgColors = {
  primary: 'bg-gray-50 dark:bg-gray-900',      // 메인 배경 (라이트모드: 아주 연한 회색)
  secondary: 'bg-gray-100 dark:bg-gray-800',   // 보조 배경
  tertiary: 'bg-gray-200 dark:bg-gray-700',    // 3차 배경
  card: 'bg-white dark:bg-gray-800',            // 카드 배경
  panel: 'bg-gray-50 dark:bg-gray-850',         // 패널 배경
  container: 'bg-white dark:bg-gray-800',       // 컨테이너 배경
} as const;

// Text Colors
export const textColors = {
  primary: 'text-gray-900 dark:text-gray-50',
  secondary: 'text-gray-600 dark:text-gray-300',
  tertiary: 'text-gray-500 dark:text-gray-400',
  muted: 'text-gray-400 dark:text-gray-500',
} as const;

// Border Colors
export const borderColors = {
  default: 'border-gray-200 dark:border-gray-700',
  strong: 'border-gray-300 dark:border-gray-600',
} as const;

// Status Colors (for Task States)
export const statusColors = {
  todo: {
    dot: 'text-blue-500 dark:text-blue-400',
    bg: 'bg-blue-50 dark:bg-blue-950',
    border: 'border-blue-200 dark:border-blue-800',
    text: {
      primary: 'text-blue-900 dark:text-blue-100',
      secondary: 'text-blue-700 dark:text-blue-300',
    }
  },
  progress: {
    dot: 'text-orange-500 dark:text-orange-400',
    bg: 'bg-orange-50 dark:bg-orange-950',
    border: 'border-orange-200 dark:border-orange-800',
    text: {
      primary: 'text-orange-900 dark:text-orange-100',
      secondary: 'text-orange-700 dark:text-orange-300',
    }
  },
  completed: {
    dot: 'text-green-500 dark:text-green-400',
    bg: 'bg-green-50 dark:bg-green-950',
    border: 'border-green-200 dark:border-green-800',
    text: {
      primary: 'text-green-900 dark:text-green-100',
      secondary: 'text-green-700 dark:text-green-300',
    }
  }
} as const;

// Badge Colors (for Task Types) — single source of truth
// All canonical TaskTypes are covered. label has no emoji (consistent across all types).
export const badgeColors = {
  setup:           { color: 'bg-slate-500 dark:bg-slate-600 text-white',  label: 'SETUP' },
  'design-system': { color: 'bg-purple-500 dark:bg-purple-600 text-white', label: 'DESIGN-SYS' },
  feature:         { color: 'bg-blue-500 dark:bg-blue-600 text-white',    label: 'FEATURE' },
  ui:              { color: 'bg-pink-500 dark:bg-pink-600 text-white',    label: 'UI' },
  'test-code':     { color: 'bg-amber-500 dark:bg-amber-600 text-white',  label: 'TEST-CODE' },
  doc:             { color: 'bg-teal-500 dark:bg-teal-600 text-white',    label: 'DOC' },
  verification:    { color: 'bg-green-600 dark:bg-green-700 text-white',  label: 'VERIFY' },
  error:           { color: 'bg-red-500 dark:bg-red-600 text-white',      label: 'ERROR' },
  explain:         { color: 'bg-cyan-500 dark:bg-cyan-600 text-white',    label: 'EXPLAIN' },
} as const;

// Button Styles
export const buttonStyles = {
  primary: 'bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 text-white',
  secondary: 'bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-900 dark:text-white',
  danger: 'bg-red-600 hover:bg-red-700 dark:bg-red-500 dark:hover:bg-red-600 text-white',
  outline: 'border-2 border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300',
} as const;

// Hover States
export const hoverColors = {
  default: 'hover:bg-gray-100 dark:hover:bg-gray-700',
  light: 'hover:bg-gray-50 dark:hover:bg-gray-800',
} as const;

// Helper function to combine classes
export const cn = (...classes: (string | undefined | false)[]) => {
  return classes.filter(Boolean).join(' ');
};


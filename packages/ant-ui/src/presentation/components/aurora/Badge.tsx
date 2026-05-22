
import * as React from 'react';
import { Icon } from './Icon';

/**
 * Aurora Badge — pill label. Ported from ui.jsx tones + sizes tables verbatim.
 *
 * Dark-theme tone override is read from `document.documentElement.dataset.theme`
 * at render. Before T2 ships the data-theme switch, the read returns the default
 * (undefined → light path) which is harmless.
 */

export type BadgeTone =
  | 'neutral'
  | 'brand'
  | 'pink'
  | 'orange'
  | 'success'
  | 'warning'
  | 'error'
  | 'info';

export type BadgeSize = 'sm' | 'md' | 'lg';

export interface BadgeProps {
  tone?: BadgeTone;
  size?: BadgeSize;
  dot?: boolean;
  icon?: string;
  children?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  title?: string;
}

interface ToneSpec {
  bg: string;
  fg: string;
  border: string;
}

function getToneSpec(tone: BadgeTone): ToneSpec {
  // Light-theme defaults (per ui.jsx tones table)
  const light: Record<BadgeTone, ToneSpec> = {
    neutral: { bg: 'var(--bg-surface-2)', fg: 'var(--text-2)', border: 'var(--border-2)' },
    brand: { bg: 'oklch(94% 0.05 290)', fg: 'var(--violet-700)', border: 'var(--violet-200)' },
    pink: { bg: 'oklch(94% 0.05 350)', fg: 'var(--pink-600)', border: 'var(--pink-200)' },
    orange: { bg: 'oklch(94% 0.05 50)', fg: 'var(--orange-600)', border: 'var(--orange-200)' },
    success: { bg: 'var(--status-done-bg)', fg: 'var(--status-done-fg)', border: 'transparent' },
    warning: {
      bg: 'var(--status-progress-bg)',
      fg: 'var(--status-progress-fg)',
      border: 'transparent',
    },
    error: { bg: 'var(--status-error-bg)', fg: 'var(--status-error-fg)', border: 'transparent' },
    info: { bg: 'var(--status-todo-bg)', fg: 'var(--status-todo-fg)', border: 'transparent' },
  };

  const spec = { ...light[tone] };

  // Dark-theme overrides — only for the warm-tinted tones from ui.jsx
  const isDark =
    typeof document !== 'undefined' &&
    document.documentElement.dataset.theme === 'dark';

  if (isDark) {
    if (tone === 'brand') {
      spec.bg = 'oklch(28% 0.10 290)';
      spec.fg = 'var(--violet-300)';
      spec.border = 'transparent';
    } else if (tone === 'pink') {
      spec.bg = 'oklch(28% 0.10 350)';
      spec.fg = 'var(--pink-300)';
      spec.border = 'transparent';
    } else if (tone === 'orange') {
      spec.bg = 'oklch(30% 0.10 50)';
      spec.fg = 'var(--orange-400)';
      spec.border = 'transparent';
    }
  }

  return spec;
}

const SIZE_TABLE: Record<BadgeSize, { h: number; px: number; fs: number }> = {
  sm: { h: 20, px: 8, fs: 10 },
  md: { h: 24, px: 10, fs: 11 },
  lg: { h: 28, px: 12, fs: 12 },
};

export function Badge({
  tone = 'neutral',
  size = 'md',
  dot,
  icon,
  children,
  className,
  style,
  title,
}: BadgeProps) {
  const spec = getToneSpec(tone);
  const s = SIZE_TABLE[size];

  return (
    <span
      className={className}
      title={title}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        height: s.h,
        padding: `0 ${s.px}px`,
        background: spec.bg,
        color: spec.fg,
        borderRadius: 'var(--r-pill)',
        border: spec.border === 'transparent' ? 'none' : `1px solid ${spec.border}`,
        fontSize: s.fs,
        fontWeight: 600,
        letterSpacing: 0.2,
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      {dot && (
        <span
          aria-hidden
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: 'currentColor',
            display: 'inline-block',
          }}
        />
      )}
      {icon && <Icon name={icon} size={s.fs} />}
      {children}
    </span>
  );
}

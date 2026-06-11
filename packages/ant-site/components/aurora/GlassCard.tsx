import type { CSSProperties, ReactNode } from 'react';

export type CardGradient = 'aurora' | 'violet-pink' | 'pink-orange' | 'cool' | 'sunset' | 'none';
export type CardPadding = 'none' | 'sm' | 'md' | 'lg' | 'xl';

interface GlassCardProps {
  glow?: boolean;
  gradient?: CardGradient;
  hoverable?: boolean;
  padding?: CardPadding;
  className?: string;
  style?: CSSProperties;
  id?: string;
  children?: ReactNode;
}

const PAD: Record<CardPadding, number> = { none: 0, sm: 14, md: 22, lg: 30, xl: 40 };

const GRADIENT: Record<Exclude<CardGradient, 'none'>, string> = {
  aurora: 'var(--gradient-aurora)',
  'violet-pink': 'var(--gradient-violet-pink)',
  'pink-orange': 'var(--gradient-pink-orange)',
  cool: 'var(--gradient-cool)',
  sunset: 'var(--gradient-sunset)',
};

/**
 * Glassmorphic surface card. Optional aurora `glow` underlay, `gradient`
 * background, and `hoverable` lift. Hover/glow handled in CSS (aurora.css) so
 * this stays a server-renderable presentational component.
 */
export function GlassCard({
  glow,
  gradient = 'none',
  hoverable,
  padding = 'md',
  className,
  style,
  id,
  children,
}: GlassCardProps) {
  const background = gradient !== 'none' ? GRADIENT[gradient] : 'var(--bg-surface)';
  const cls = ['aurora-card', hoverable ? 'aurora-card-hover' : '', className].filter(Boolean).join(' ');

  return (
    <div
      id={id}
      className={cls}
      style={{
        position: 'relative',
        background,
        borderRadius: 'var(--r-2xl)',
        padding: PAD[padding],
        border: '1px solid var(--border-1)',
        boxShadow: 'var(--shadow-sm)',
        color: 'var(--text-1)',
        ...style,
      }}
    >
      {glow && (
        <div
          aria-hidden
          className="aurora-card-glow"
          style={{
            position: 'absolute',
            inset: -1,
            borderRadius: 'inherit',
            background: 'var(--gradient-aurora)',
            filter: 'blur(22px)',
            zIndex: -1,
          }}
        />
      )}
      {children}
    </div>
  );
}

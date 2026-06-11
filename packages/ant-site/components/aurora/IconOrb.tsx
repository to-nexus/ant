import type { CSSProperties, ReactNode } from 'react';

export type IconOrbTone = 'violet' | 'pink' | 'orange' | 'teal' | 'emerald';

interface IconOrbProps {
  tone?: IconOrbTone;
  size?: number;
  pulse?: boolean;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}

interface TonePalette {
  hue: number;
  fg: string;
}

const TONES: Record<IconOrbTone, TonePalette> = {
  violet: { hue: 290, fg: 'var(--violet-300)' },
  pink: { hue: 350, fg: 'oklch(80% 0.14 350)' },
  orange: { hue: 50, fg: 'var(--orange-400)' },
  teal: { hue: 195, fg: 'var(--teal-400)' },
  emerald: { hue: 155, fg: 'oklch(78% 0.15 155)' },
};

/**
 * Tone-driven circular icon orb with a soft pulsing halo. Dark-only palette.
 * Pass a lucide icon as children.
 */
export function IconOrb({ tone = 'violet', size = 48, pulse = true, className, style, children }: IconOrbProps) {
  const t = TONES[tone];
  return (
    <div
      className={className}
      style={{
        position: 'relative',
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: '50%',
        background: `oklch(26% 0.09 ${t.hue})`,
        border: `1px solid oklch(40% 0.10 ${t.hue} / 0.6)`,
        color: t.fg,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        ...style,
      }}
    >
      <span
        aria-hidden
        style={{
          position: 'absolute',
          inset: -8,
          borderRadius: '50%',
          background: `oklch(64% 0.22 ${t.hue} / 0.35)`,
          filter: 'blur(14px)',
          opacity: 0.7,
          zIndex: 0,
          animation: pulse ? 'pulse-soft 2.8s ease-in-out infinite' : undefined,
        }}
      />
      <span style={{ position: 'relative', zIndex: 1, display: 'inline-flex' }}>{children}</span>
    </div>
  );
}


import * as React from 'react';
import { Icon } from './Icon';

/**
 * Aurora IconOrb — typed circular icon used by AlertModal,
 * UploadConflictModal, and DesktopConnectModal. Ported from
 * visual/ui/handoff/project/d1-modals.jsx `IconOrb`.
 *
 * Tone-driven palette: each `type` maps to a foreground / background /
 * halo trio (`oklch`) that adapts to dark mode by reading
 * `document.documentElement.dataset.theme` at render time and
 * subscribing to its mutations.
 *
 * Browser-runtime: the orb references `document` on the client. The
 * `useState` initializer guards SSR by checking `typeof document` and
 * the `useEffect` MutationObserver runs only after mount.
 */

export type IconOrbTone = 'info' | 'success' | 'warning' | 'error';

export interface IconOrbProps {
  type?: IconOrbTone;
  size?: number;
  /** Override the default icon glyph for the tone. */
  customIcon?: string;
  style?: React.CSSProperties;
  className?: string;
}

interface TonePalette {
  fg: string;
  bg: string;
  halo: string;
  icon: string;
  hue: number;
}

const TONES: Record<IconOrbTone, TonePalette> = {
  info: {
    fg: 'var(--violet-600)',
    bg: 'oklch(94% 0.05 290)',
    halo: 'oklch(64% 0.20 290 / 0.40)',
    icon: 'compass',
    hue: 290,
  },
  success: {
    fg: 'oklch(45% 0.14 155)',
    bg: 'oklch(94% 0.05 155)',
    halo: 'oklch(70% 0.16 155 / 0.45)',
    icon: 'check-circle',
    hue: 155,
  },
  warning: {
    fg: 'var(--orange-600)',
    bg: 'oklch(94% 0.05 50)',
    halo: 'oklch(70% 0.18 50 / 0.45)',
    icon: 'alert-triangle',
    hue: 50,
  },
  error: {
    fg: 'var(--red-500)',
    bg: 'oklch(94% 0.04 25)',
    halo: 'oklch(65% 0.22 25 / 0.45)',
    icon: 'shield-alert',
    hue: 25,
  },
};

const DARK_FG: Record<IconOrbTone, string> = {
  info: 'var(--violet-300)',
  success: 'oklch(75% 0.15 155)',
  warning: 'var(--orange-400)',
  error: 'oklch(75% 0.18 25)',
};

function readTheme(): 'light' | 'dark' {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

export function IconOrb({
  type = 'info',
  size = 48,
  customIcon,
  style,
  className,
}: IconOrbProps) {
  const [theme, setTheme] = React.useState<'light' | 'dark'>(() => readTheme());

  React.useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    const update = () => setTheme(readTheme());
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.attributeName === 'data-theme') {
          update();
          return;
        }
      }
    });
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    // Re-sync in case the theme attribute changed between initializer and effect.
    update();
    return () => observer.disconnect();
  }, []);

  const tone = TONES[type];
  const isDark = theme === 'dark';
  const bg = isDark ? `oklch(28% 0.10 ${tone.hue})` : tone.bg;
  const fg = isDark ? DARK_FG[type] : tone.fg;

  return (
    <div
      className={className}
      style={{
        position: 'relative',
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: '50%',
        background: bg,
        color: fg,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        ...style,
      }}
    >
      {/* Halo */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: -8,
          borderRadius: '50%',
          background: tone.halo,
          filter: 'blur(14px)',
          opacity: 0.7,
          zIndex: 0,
          animation: 'pulse-soft 2.6s ease-in-out infinite',
        }}
      />
      <div style={{ position: 'relative', zIndex: 1, display: 'inline-flex' }}>
        <Icon name={customIcon || tone.icon} size={Math.round(size * 0.46)} stroke={2} />
      </div>
    </div>
  );
}

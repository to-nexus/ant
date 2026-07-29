import { twMerge } from 'tailwind-merge';
import { GLYPH_SIZE, GLYPH_TONE, type GlyphSize, type GlyphTone } from './glyphScale';

export type SpinnerSize = GlyphSize;
export type SpinnerTone = GlyphTone;

export interface SpinnerProps {
  size?: SpinnerSize;
  tone?: SpinnerTone;
  className?: string;
  label?: string;
  style?: React.CSSProperties;
}

/**
 * The SOLE legal consumer of lucide-react's Loader2 and Tailwind's animate-spin.
 * All other components must import Spinner from
 * `@/presentation/components/common/async`. Enforced by ESLint + CI grep guard.
 *
 * Aurora visual: violet→pink dual-border ring driven by the `spin`
 * keyframe defined in `src/styles/aurora-tokens.css`.
 */
export function Spinner({ size = 'md', tone = 'muted', className = '', label, style }: SpinnerProps) {
  const color = GLYPH_TONE[tone];
  return (
    <svg
      className={twMerge(GLYPH_SIZE[size], className)}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ animation: 'spin 0.8s linear infinite', ...style }}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'status' : undefined}
    >
      <circle cx="12" cy="12" r="9" opacity={0.25} />
      <path d="M21 12a9 9 0 0 0-9-9" />
    </svg>
  );
}

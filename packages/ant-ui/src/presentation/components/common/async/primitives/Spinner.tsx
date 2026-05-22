import { twMerge } from 'tailwind-merge';

export type SpinnerSize = 'sm' | 'md' | 'lg';
export type SpinnerTone = 'muted' | 'accent' | 'inverse' | 'inherit';

const SIZE: Record<SpinnerSize, string> = {
  sm: 'w-3.5 h-3.5',
  md: 'w-4 h-4',
  lg: 'w-6 h-6',
};

const TONE: Record<SpinnerTone, string> = {
  muted: 'var(--text-3)',
  accent: 'var(--violet-500)',
  inverse: 'white',
  inherit: 'currentColor',
};

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
  const color = TONE[tone];
  return (
    <svg
      className={twMerge(SIZE[size], className)}
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

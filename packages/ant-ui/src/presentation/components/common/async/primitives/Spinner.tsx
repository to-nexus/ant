import { Loader2 } from 'lucide-react';
import { twMerge } from 'tailwind-merge';

export type SpinnerSize = 'sm' | 'md' | 'lg';
export type SpinnerTone = 'muted' | 'accent' | 'inverse' | 'inherit';

const SIZE: Record<SpinnerSize, string> = {
  sm: 'w-3.5 h-3.5',
  md: 'w-4 h-4',
  lg: 'w-6 h-6',
};

const TONE: Record<SpinnerTone, string> = {
  muted: 'text-gray-400 dark:text-gray-500',
  accent: 'text-blue-500 dark:text-blue-400',
  inverse: 'text-white',
  inherit: '',
};

export interface SpinnerProps {
  size?: SpinnerSize;
  tone?: SpinnerTone;
  className?: string;
  label?: string;
}

/**
 * The SOLE legal consumer of lucide-react's Loader2 and Tailwind's animate-spin.
 * All other components must import Spinner from
 * `@/presentation/components/common/async`. Enforced by ESLint + CI grep guard.
 */
export function Spinner({ size = 'md', tone = 'muted', className = '', label }: SpinnerProps) {
  return (
    <Loader2
      className={twMerge(SIZE[size], 'animate-spin', TONE[tone], className)}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'status' : undefined}
    />
  );
}

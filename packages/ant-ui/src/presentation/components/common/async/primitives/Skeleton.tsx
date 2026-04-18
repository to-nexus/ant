import type { ReactNode } from 'react';
import { twMerge } from 'tailwind-merge';

export type SkeletonVariant = 'text' | 'rect' | 'circle' | 'card';

export interface SkeletonProps {
  variant?: SkeletonVariant;
  className?: string;
  delayMs?: number;
  /**
   * Only meaningful for `variant="card"` — places arbitrary nested
   * skeleton primitives inside a bordered card shell. Leaf variants
   * (text/rect/circle) ignore children and render as a solid block.
   */
  children?: ReactNode;
}

const SHAPE: Record<SkeletonVariant, string> = {
  text: 'h-4 rounded',
  rect: 'rounded',
  circle: 'rounded-full',
  card: 'rounded-lg border border-gray-200 dark:border-[#30363d] bg-gray-100 dark:bg-gray-800 p-3',
};

/**
 * The SOLE legal consumer of Tailwind's animate-pulse. Use `variant` for
 * shape, `className` for size, `delayMs` to stagger multiple adjacent lines.
 * `children` is used only with the `card` variant to nest row skeletons.
 */
export function Skeleton({ variant = 'rect', className = '', delayMs = 0, children }: SkeletonProps) {
  const base =
    variant === 'card'
      ? 'animate-pulse'
      : 'animate-pulse bg-gray-200 dark:bg-gray-700';
  // twMerge resolves utility-class conflicts deterministically so callers
  // can override colours/sizes via className without source-order guessing.
  return (
    <div
      className={twMerge(base, SHAPE[variant], className)}
      style={delayMs ? { animationDelay: `${delayMs}ms` } : undefined}
      aria-hidden
    >
      {variant === 'card' ? children : null}
    </div>
  );
}

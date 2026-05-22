import type { CSSProperties } from 'react';
import { twMerge } from 'tailwind-merge';
import { Spinner } from './Spinner';

export type StepStatus = 'pending' | 'active' | 'complete' | 'failed';

export interface StepIndicatorStep {
  id: string;
  label: string;
  status: StepStatus;
  /** Optional duration text rendered next to the label (e.g. "2.3s"). */
  trailing?: string;
}

export interface StepIndicatorProps {
  steps: StepIndicatorStep[];
  orientation?: 'horizontal' | 'vertical';
  className?: string;
  /** ARIA label for the whole indicator. Defaults to "Progress". */
  ariaLabel?: string;
}

const STATE_DOT_CLASS: Record<StepStatus, string> = {
  pending: 'text-[color:var(--text-3)]',
  active: 'text-white',
  complete: 'text-[color:var(--status-done-fg)]',
  failed: 'text-[color:var(--status-error-fg)]',
};

const STATE_DOT_STYLE: Record<StepStatus, CSSProperties> = {
  pending: { background: 'var(--bg-surface-3)' },
  active: { background: 'var(--violet-500)' },
  complete: { background: 'var(--status-done-bg)' },
  failed: { background: 'var(--status-error-bg)' },
};

const STATE_LABEL_CLASS: Record<StepStatus, string> = {
  pending: 'text-[color:var(--text-3)]',
  active: 'text-[color:var(--text-1)] font-medium',
  complete: 'text-[color:var(--text-2)]',
  failed: 'text-[color:var(--status-error-fg)] font-medium',
};

const STATE_CONNECTOR_STYLE: Record<StepStatus, CSSProperties> = {
  pending: { background: 'var(--border-1)' },
  active: { background: 'var(--violet-300)' },
  complete: { background: 'var(--status-done-fg)' },
  failed: { background: 'var(--status-error-fg)' },
};

/**
 * Generic multi-step indicator. The IDE startup overlay is the first consumer
 * (5 phases of pod readiness), but the primitive is intentionally domain-blind
 * so any other multi-step async surface can adopt it without a refactor.
 *
 * - `Spinner` reuse for the active step keeps the lone Loader2 import in the
 *   async-primitives boundary intact.
 * - `aria-current="step"` marks the active step for assistive tech; the parent
 *   gets `role="list"` so step transitions are announced as a list update.
 */
export function StepIndicator({
  steps,
  orientation = 'horizontal',
  className,
  ariaLabel = 'Progress',
}: StepIndicatorProps) {
  const isVertical = orientation === 'vertical';
  return (
    <ol
      role="list"
      aria-label={ariaLabel}
      className={twMerge(
        isVertical ? 'flex flex-col gap-3' : 'flex flex-row items-center gap-2',
        className,
      )}
    >
      {steps.map((step, idx) => {
        const isLast = idx === steps.length - 1;
        return (
          <li
            key={step.id}
            role="listitem"
            aria-current={step.status === 'active' ? 'step' : undefined}
            className={twMerge(
              isVertical ? 'flex flex-row items-center gap-3' : 'flex flex-row items-center gap-2 flex-1 min-w-0',
            )}
          >
            <div className="flex items-center gap-2 min-w-0">
              <span
                className={twMerge(
                  'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold transition-colors',
                  STATE_DOT_CLASS[step.status],
                )}
                style={STATE_DOT_STYLE[step.status]}
                aria-hidden="true"
              >
                {step.status === 'active' ? (
                  <Spinner size="sm" tone="inverse" />
                ) : step.status === 'complete' ? (
                  '✓'
                ) : step.status === 'failed' ? (
                  '!'
                ) : (
                  String(idx + 1)
                )}
              </span>
              <span className={twMerge('text-sm truncate', STATE_LABEL_CLASS[step.status])}>{step.label}</span>
              {step.trailing && (
                <span
                  className="text-xs tabular-nums whitespace-nowrap"
                  style={{ color: 'var(--text-4)' }}
                >
                  {step.trailing}
                </span>
              )}
            </div>
            {!isLast && !isVertical && (
              <span
                className="flex-1 h-px"
                style={STATE_CONNECTOR_STYLE[step.status === 'complete' ? 'complete' : 'pending']}
                aria-hidden="true"
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

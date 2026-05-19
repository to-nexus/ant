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
  pending: 'bg-gray-300 dark:bg-[#30363d] text-gray-500 dark:text-gray-500',
  active: 'bg-blue-500 dark:bg-blue-400 text-white ring-4 ring-blue-100 dark:ring-blue-900/40',
  complete: 'bg-emerald-500 dark:bg-emerald-400 text-white',
  failed: 'bg-rose-500 dark:bg-rose-400 text-white',
};

const STATE_LABEL_CLASS: Record<StepStatus, string> = {
  pending: 'text-gray-500 dark:text-gray-400',
  active: 'text-gray-900 dark:text-gray-100 font-medium',
  complete: 'text-gray-600 dark:text-gray-300',
  failed: 'text-rose-600 dark:text-rose-400 font-medium',
};

const STATE_CONNECTOR_CLASS: Record<StepStatus, string> = {
  pending: 'bg-gray-200 dark:bg-[#30363d]',
  active: 'bg-blue-300 dark:bg-blue-700',
  complete: 'bg-emerald-400 dark:bg-emerald-500',
  failed: 'bg-rose-400 dark:bg-rose-500',
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
                <span className="text-xs text-gray-400 dark:text-gray-500 tabular-nums whitespace-nowrap">
                  {step.trailing}
                </span>
              )}
            </div>
            {!isLast && (
              <span
                className={twMerge(
                  isVertical
                    ? 'ml-3 w-px h-3'
                    : 'flex-1 h-px',
                  STATE_CONNECTOR_CLASS[step.status === 'complete' ? 'complete' : 'pending'],
                )}
                aria-hidden="true"
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

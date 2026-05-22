
import * as React from 'react';
import { Check } from 'lucide-react';

/**
 * Aurora WizardStepIndicator — shared primitive (spec §4.6.7).
 *
 * Generic over the underlying step shape: callers project their own data
 * to `WizardStep[]`. Used by BasisWizard (T9) and ProjectWizardModal (T10).
 *
 * Color rules (§5.5):
 * - active + hasValue   → emerald pill + ✓ check
 * - active + !hasValue  → violet pill (no check)
 * - completed (idx < currentIndex && hasValue) → neutral text + ✓ check (clickable)
 * - upcoming            → muted text
 *
 * Connector:
 * - idx <= currentIndex → emerald→teal gradient
 * - otherwise           → border-2
 * - group boundary (adjacent group differs) → 4×4 rounded dot replacing line
 */

export interface WizardStep {
  id: string;
  label: string;
  hasValue: boolean;
  group?: string;
}

export interface WizardStepIndicatorProps {
  steps: WizardStep[];
  currentIndex: number;
  onStepClick: (index: number) => void;
  size?: 'sm' | 'md';
  showDone?: boolean;
  onDone?: () => void;
  doneLabel?: string;
}

const SIZE_TABLE = {
  sm: { padX: 8, padY: 3, font: 11, gap: 4, checkSize: 11, connector: 18, dot: 4 },
  md: { padX: 10, padY: 4, font: 12, gap: 5, checkSize: 12, connector: 20, dot: 4 },
} as const;

export function WizardStepIndicator({
  steps,
  currentIndex,
  onStepClick,
  size = 'md',
  showDone = false,
  onDone,
  doneLabel = 'Done',
}: WizardStepIndicatorProps) {
  const dims = SIZE_TABLE[size];

  return (
    <div
      className="flex items-center min-w-0 overflow-x-auto scrollbar-hide"
      style={{ gap: 0 }}
    >
      {steps.map((step, idx) => {
        const isActive = idx === currentIndex;
        const isCompleted = !isActive && step.hasValue && idx < currentIndex;
        const isClickable = !isActive && step.hasValue;

        const prevStep = idx > 0 ? steps[idx - 1] : undefined;
        const isGroupBoundary =
          !!step.group && !!prevStep?.group && step.group !== prevStep.group;

        // Pill style derivation
        let pillStyle: React.CSSProperties = {};
        let pillColor = 'var(--text-3)';

        if (isActive) {
          if (step.hasValue) {
            pillStyle = {
              background: 'oklch(94% 0.08 155)',
              boxShadow: 'inset 0 0 0 1px oklch(80% 0.12 155)',
            };
            pillColor = 'var(--emerald-600)';
          } else {
            pillStyle = {
              background: 'oklch(96% 0.04 285)',
              boxShadow: 'inset 0 0 0 1px oklch(80% 0.10 285)',
            };
            pillColor = 'var(--violet-600)';
          }
        } else if (isCompleted) {
          pillColor = 'var(--text-2)';
        }

        return (
          <div key={step.id} className="flex items-center shrink-0">
            {idx > 0 && (
              <div
                className="shrink-0"
                style={{
                  width: isGroupBoundary ? dims.dot : dims.connector,
                  height: isGroupBoundary ? dims.dot : 1,
                  margin: '0 4px',
                  borderRadius: isGroupBoundary ? '50%' : 0,
                  background: isGroupBoundary
                    ? 'var(--border-3)'
                    : idx <= currentIndex
                      ? 'linear-gradient(90deg, var(--emerald-400), var(--teal-400))'
                      : 'var(--border-2)',
                  transition: 'background 220ms var(--ease-smooth)',
                }}
                aria-hidden
              />
            )}
            <button
              type="button"
              onClick={() => isClickable && onStepClick(idx)}
              disabled={!isClickable}
              className="shrink-0"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: dims.gap,
                padding: `${dims.padY}px ${dims.padX}px`,
                borderRadius: 9999,
                fontSize: dims.font,
                fontWeight: 600,
                color: pillColor,
                background: 'transparent',
                border: 'none',
                whiteSpace: 'nowrap',
                cursor: isClickable ? 'pointer' : isActive ? 'default' : 'not-allowed',
                transition: 'background 180ms var(--ease-smooth), color 180ms var(--ease-smooth)',
                ...pillStyle,
              }}
              aria-current={isActive ? 'step' : undefined}
            >
              {(isCompleted || (isActive && step.hasValue)) && (
                <Check
                  style={{
                    width: dims.checkSize,
                    height: dims.checkSize,
                    color: 'var(--emerald-500)',
                  }}
                  strokeWidth={3}
                />
              )}
              <span>{step.label}</span>
            </button>
          </div>
        );
      })}

      {showDone && onDone && (
        <>
          <div
            className="shrink-0"
            style={{
              width: dims.connector,
              height: 1,
              margin: '0 4px',
              background:
                'linear-gradient(90deg, var(--emerald-400), var(--teal-400))',
            }}
            aria-hidden
          />
          <button
            type="button"
            onClick={onDone}
            className="shrink-0"
            style={{
              padding: `${dims.padY + 1}px ${dims.padX + 4}px`,
              borderRadius: 9999,
              fontSize: dims.font,
              fontWeight: 700,
              color: 'var(--text-on-brand)',
              background: 'var(--gradient-aurora)',
              backgroundSize: '200% 200%',
              boxShadow: 'var(--shadow-glow-aurora)',
              border: 'none',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              animation: 'gradient-shift 5s ease-in-out infinite',
            }}
          >
            {doneLabel}
          </button>
        </>
      )}
    </div>
  );
}

import { Check, X, Save, ArrowRight, CheckCircle } from 'lucide-react';
import type { WizardStepDef } from './types';

interface WizardFooterProps {
  steps: WizardStepDef[];
  currentIndex: number;
  onStepClick: (index: number) => void;
  lang: 'en' | 'ko';
  getSelectedForStep: (step: WizardStepDef) => string | undefined;
  hasPendingChanges: boolean;
  onSave: () => void;
  onDiscard: () => void;
  onNext: () => void;
  nextLabel: string;
  nextEnabled: boolean;
  isAllComplete: boolean;
}

export function WizardFooter({
  steps,
  currentIndex,
  onStepClick,
  lang,
  getSelectedForStep,
  hasPendingChanges,
  onSave,
  onDiscard,
  onNext,
  nextLabel,
  nextEnabled,
  isAllComplete,
}: WizardFooterProps) {
  return (
    <div className="flex items-center justify-between px-4 py-2.5 border-t border-gray-100 dark:border-gray-800 bg-white dark:bg-[#161b22] gap-3">
      {/* Left: step indicators */}
      <div className="flex items-center gap-0 min-w-0 overflow-x-auto scrollbar-hide shrink">
        {steps.map((step, idx) => {
          const isActive = idx === currentIndex;
          const hasValue = getSelectedForStep(step) !== undefined;
          const isCompleted = hasValue && !isActive;
          const isClickable = !isActive && hasValue;

          const prevStep = idx > 0 ? steps[idx - 1] : undefined;
          const isGroupBoundary = !!step.group && !!prevStep?.group && step.group !== prevStep.group;

          return (
            <div key={step.id} className="flex items-center shrink-0">
              {isGroupBoundary ? (
                <div className="flex items-center mx-2 shrink-0">
                  <div className="w-1.5 h-1.5 rounded-full bg-gray-300 dark:bg-gray-600" />
                </div>
              ) : idx > 0 ? (
                <div className={`w-5 h-px mx-0.5 transition-colors duration-300 ${
                  idx <= currentIndex ? 'bg-blue-400' : 'bg-gray-200 dark:bg-gray-700'
                }`} />
              ) : null}
              <button
                type="button"
                onClick={() => isClickable && onStepClick(idx)}
                disabled={!isClickable}
                className={`
                  flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-all whitespace-nowrap
                  ${isActive
                    ? hasValue
                      ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 ring-1 ring-emerald-200 dark:ring-emerald-800'
                      : 'bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 ring-1 ring-blue-200 dark:ring-blue-800'
                    : isCompleted
                      ? 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer'
                      : 'text-gray-400 dark:text-gray-500'}
                `}
              >
                {(isCompleted || (isActive && hasValue)) && (
                  <Check className="w-3 h-3 text-emerald-500" strokeWidth={3} />
                )}
                <span>{step.title[lang] ?? step.title.en}</span>
              </button>
            </div>
          );
        })}
      </div>

      {/* Right: action buttons */}
      <div className="flex items-center gap-1.5 shrink-0">
        {hasPendingChanges && (
          <button
            type="button"
            onClick={onDiscard}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
            <span>{lang === 'ko' ? '취소' : 'Discard'}</span>
          </button>
        )}

        {hasPendingChanges && (
          <button
            type="button"
            onClick={onSave}
            className="flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40 hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors"
          >
            <Save className="w-3.5 h-3.5" />
            <span>{lang === 'ko' ? '저장' : 'Save'}</span>
          </button>
        )}

        <button
          type="button"
          onClick={onNext}
          disabled={!nextEnabled}
          className={`
            flex items-center gap-1.5 px-3.5 py-1.5 rounded-md text-xs font-semibold transition-colors
            ${nextEnabled
              ? isAllComplete
                ? 'bg-emerald-500 text-white hover:bg-emerald-600'
                : 'bg-blue-500 text-white hover:bg-blue-600'
              : 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500 cursor-not-allowed'}
          `}
        >
          {isAllComplete
            ? <><CheckCircle className="w-3.5 h-3.5" /><span>{nextLabel}</span></>
            : <><span>{nextLabel}</span><ArrowRight className="w-3.5 h-3.5" /></>
          }
        </button>
      </div>
    </div>
  );
}

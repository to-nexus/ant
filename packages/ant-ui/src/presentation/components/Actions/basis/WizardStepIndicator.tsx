import { Check } from 'lucide-react';
import type { WizardStepDef } from './types';

interface WizardStepIndicatorProps {
  steps: WizardStepDef[];
  currentIndex: number;
  onStepClick: (index: number) => void;
  lang: 'en' | 'ko';
  getSelectedForStep: (step: WizardStepDef) => string | undefined;
  onDone?: () => void;
  showDone?: boolean;
}

export function WizardStepIndicator({
  steps,
  currentIndex,
  onStepClick,
  lang,
  getSelectedForStep,
  onDone,
  showDone,
}: WizardStepIndicatorProps) {
  return (
    <div className="flex items-center justify-center gap-0 px-4 py-3 border-t border-gray-100 dark:border-gray-800 bg-white dark:bg-[#161b22]">
      {steps.map((step, idx) => {
        const isActive = idx === currentIndex;
        const isCompleted = getSelectedForStep(step) !== undefined && idx < currentIndex;
        const isClickable = idx < currentIndex;

        return (
          <div key={step.id} className="flex items-center">
            {idx > 0 && (
              <div className={`w-8 h-px mx-1 transition-colors duration-300 ${
                idx <= currentIndex ? 'bg-blue-400' : 'bg-gray-200 dark:bg-gray-700'
              }`} />
            )}
            <button
              type="button"
              onClick={() => isClickable && onStepClick(idx)}
              disabled={!isClickable}
              className={`
                flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-all
                ${isActive
                  ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 ring-1 ring-blue-200 dark:ring-blue-800'
                  : isCompleted
                    ? 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer'
                    : 'text-gray-400 dark:text-gray-500'}
              `}
            >
              {isCompleted && (
                <Check className="w-3 h-3 text-emerald-500" strokeWidth={3} />
              )}
              <span className="whitespace-nowrap">
                {`(${idx + 1})`} {step.title[lang] ?? step.title.en}
              </span>
            </button>
          </div>
        );
      })}

      {showDone && onDone && (
        <>
          <div className="w-8 h-px mx-1 bg-gray-200 dark:bg-gray-700" />
          <button
            type="button"
            onClick={onDone}
            className="px-3 py-1 rounded-full text-xs font-semibold bg-blue-500 text-white hover:bg-blue-600 transition-colors"
          >
            {lang === 'ko' ? '완료' : 'Done'}
          </button>
        </>
      )}
    </div>
  );
}

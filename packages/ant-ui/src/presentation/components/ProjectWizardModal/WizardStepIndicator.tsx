import { Check } from 'lucide-react';
import { cn } from '@/shared/utils/design-system';
import type { WizardStep } from './types';

const STEP_LABELS: Record<WizardStep, string> = { 1: 'step1Title', 2: 'step2Title', 3: 'step3Title' };

export function WizardStepIndicator({
  currentStep, maxVisited, onStepClick, t,
}: {
  currentStep: WizardStep;
  maxVisited: WizardStep;
  onStepClick: (step: WizardStep) => void;
  t: (key: string) => string;
}) {
  const steps: WizardStep[] = [1, 2, 3];
  return (
    <div className="flex items-center gap-1">
      {steps.map((step, idx) => {
        const isCompleted = step < currentStep;
        const isCurrent = step === currentStep;
        const isClickable = step <= maxVisited && step !== currentStep;
        return (
          <div key={step} className="flex items-center gap-1">
            {idx > 0 && (
              <div className={cn(
                'w-3 sm:w-6 h-px',
                step <= currentStep ? 'bg-emerald-400 dark:bg-emerald-500' : 'bg-gray-300 dark:bg-gray-600',
              )} />
            )}
            <button
              type="button"
              disabled={!isClickable}
              onClick={() => isClickable && onStepClick(step)}
              className={cn(
                'flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium transition-all',
                isCurrent && 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400',
                isCompleted && isClickable && 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer',
                !isCompleted && !isCurrent && 'text-gray-500 dark:text-gray-400 cursor-default',
              )}
            >
              <span className={cn(
                'w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold border',
                isCurrent && 'border-emerald-500 dark:border-emerald-400 text-emerald-600 dark:text-emerald-400',
                isCompleted && 'border-emerald-500 dark:border-emerald-400 bg-emerald-500 dark:bg-emerald-400 text-white dark:text-gray-900',
                !isCompleted && !isCurrent && 'border-gray-400 dark:border-gray-500 text-gray-500 dark:text-gray-400',
              )}>
                {isCompleted ? <Check className="w-3 h-3" strokeWidth={3} /> : step}
              </span>
              <span className="hidden sm:inline">{t(`quickstart.projectWizard.${STEP_LABELS[step]}`)}</span>
            </button>
          </div>
        );
      })}
    </div>
  );
}

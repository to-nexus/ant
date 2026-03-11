import { AlertCircle, AlertTriangle } from 'lucide-react';
import { StepRow } from './StepRow';
import type { ExecStepState } from './types';

interface ExecutionProgressProps {
  t: (key: string) => string;
  mode: 'design' | 'code';
  execSteps: ExecStepState[];
  executionError: string | null;
  gitDecisionPending: boolean;
  onGitDecision: (decision: 'skip' | 'retry' | 'abort') => void;
  onRetry: () => void;
}

export function ExecutionProgress({
  t, mode, execSteps, executionError,
  gitDecisionPending, onGitDecision, onRetry,
}: ExecutionProgressProps) {
  const getStepLabel = (step: ExecStepState) => {
    const key = step.id === 'job'
      ? (mode === 'design' ? 'designJob' : 'codeJob')
      : step.id;
    return t(`quickstart.projectWizard.steps.${key}`);
  };

  return (
    <div className="py-4 space-y-3">
      {execSteps.map((step) => (
        <StepRow key={step.id} label={getStepLabel(step)} status={step.status} error={step.error} />
      ))}
      {gitDecisionPending && (
        <div className="mt-3 flex items-center gap-2 p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg">
          <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0" />
          <div className="flex-1 text-sm text-amber-700 dark:text-amber-300">{t('quickstart.projectWizard.gitErrorMessage')}</div>
          <div className="flex gap-2">
            <button onClick={() => onGitDecision('skip')} className="text-xs px-2.5 py-1 rounded-md bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700">
              {t('quickstart.projectWizard.gitErrorSkip')}
            </button>
            <button onClick={() => onGitDecision('retry')} className="text-xs px-2.5 py-1 rounded-md bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-400 hover:bg-amber-200 dark:hover:bg-amber-900">
              {t('quickstart.projectWizard.gitErrorRetry')}
            </button>
            <button onClick={() => onGitDecision('abort')} className="text-xs px-2.5 py-1 rounded-md bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-900">
              {t('quickstart.projectWizard.gitErrorAbort')}
            </button>
          </div>
        </div>
      )}
      {executionError && !gitDecisionPending && (
        <div className="mt-4 flex items-start gap-2 p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg">
          <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
          <div>
            <div className="text-sm text-red-700 dark:text-red-300">{executionError}</div>
            <button
              onClick={onRetry}
              className="mt-2 text-xs text-red-600 dark:text-red-400 underline hover:text-red-800 dark:hover:text-red-300"
            >
              {t('quickstart.errorRetry')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

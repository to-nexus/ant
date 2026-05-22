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
        <div
          className="mt-3 flex items-center gap-2 p-3"
          style={{
            background:
              'linear-gradient(135deg, oklch(96% 0.04 50 / 0.7), oklch(95% 0.03 30 / 0.55))',
            border: '1px solid oklch(82% 0.10 50)',
            borderRadius: 'var(--r-lg)',
          }}
        >
          <AlertTriangle
            className="w-4 h-4 flex-shrink-0"
            style={{ color: 'oklch(60% 0.18 50)' }}
          />
          <div
            className="flex-1 text-sm"
            style={{ color: 'oklch(45% 0.16 50)' }}
          >
            {t('quickstart.projectWizard.gitErrorMessage')}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => onGitDecision('skip')}
              className="text-xs px-2.5 py-1 transition-colors"
              style={{
                background: 'var(--bg-surface)',
                color: 'var(--text-2)',
                border: '1px solid var(--border-2)',
                borderRadius: 'var(--r-md, 8px)',
              }}
            >
              {t('quickstart.projectWizard.gitErrorSkip')}
            </button>
            <button
              onClick={() => onGitDecision('retry')}
              className="text-xs px-2.5 py-1 transition-colors"
              style={{
                background: 'oklch(92% 0.08 50)',
                color: 'oklch(45% 0.16 50)',
                border: '1px solid oklch(80% 0.12 50)',
                borderRadius: 'var(--r-md, 8px)',
                fontWeight: 600,
              }}
            >
              {t('quickstart.projectWizard.gitErrorRetry')}
            </button>
            <button
              onClick={() => onGitDecision('abort')}
              className="text-xs px-2.5 py-1 transition-colors"
              style={{
                background: 'oklch(92% 0.08 25)',
                color: 'oklch(48% 0.20 25)',
                border: '1px solid oklch(80% 0.14 25)',
                borderRadius: 'var(--r-md, 8px)',
                fontWeight: 600,
              }}
            >
              {t('quickstart.projectWizard.gitErrorAbort')}
            </button>
          </div>
        </div>
      )}
      {executionError && !gitDecisionPending && (
        <div
          className="mt-4 flex items-start gap-2 p-3"
          style={{
            background: 'var(--status-error-bg)',
            border: '1px solid oklch(82% 0.12 25)',
            borderRadius: 'var(--r-lg)',
          }}
        >
          <AlertCircle
            className="w-4 h-4 flex-shrink-0 mt-0.5"
            style={{ color: 'var(--status-error-fg)' }}
          />
          <div>
            <div className="text-sm" style={{ color: 'var(--status-error-fg)' }}>
              {executionError}
            </div>
            <button
              onClick={onRetry}
              className="mt-2 text-xs underline hover:opacity-80 transition-opacity"
              style={{ color: 'var(--status-error-fg)' }}
            >
              {t('quickstart.errorRetry')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

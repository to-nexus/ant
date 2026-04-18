import { useTranslation } from 'react-i18next';
import {
  Play,
  Square,
  RotateCw,
  ExternalLink,
  AlertCircle,
  CheckCircle,
  X,
} from 'lucide-react';
import { Spinner } from '@/presentation/components/common/async';
import type { PreviewStatus } from '@/infrastructure/http/api';

export function PreviewControlsSection({
  phase,
  isRunning,
  isReady,
  previewStatus,
  isPreviewLoading,
  isJobRunning,
  dismissedSet,
  onStart,
  onStop,
  onRestart,
  onOpenPreview,
  onDismissError,
}: {
  phase: string;
  isRunning: boolean;
  isReady: boolean;
  previewStatus: PreviewStatus | undefined;
  isPreviewLoading: boolean;
  isJobRunning: boolean;
  dismissedSet: Set<string>;
  onStart: () => void;
  onStop: () => void;
  onRestart: () => void;
  onOpenPreview: () => void;
  onDismissError: (key: string) => void;
}) {
  const { t } = useTranslation('explorer');

  return (
    <section className="rounded-lg border border-gray-200 dark:border-gray-700 p-4">
      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
        {t('preview.controls', 'Preview Controls')}
      </h3>

      {/* Status badge */}
      <div className="flex items-center gap-2 mb-4">
        {phase === 'running' && isReady ? (
          <div className="flex items-center gap-1.5">
            <CheckCircle className="w-4 h-4 text-green-500" />
            <span className="text-sm font-medium text-green-700 dark:text-green-300">{t('preview.running')}</span>
          </div>
        ) : phase === 'stopping' ? (
          <div className="flex items-center gap-1.5">
            <Spinner size="md" className="text-orange-500" />
            <span className="text-sm font-medium text-orange-700 dark:text-orange-300">{t('preview.stopping')}</span>
          </div>
        ) : phase === 'running' || phase === 'starting' || phase === 'installing' ? (
          <div className="flex items-center gap-1.5">
            <Spinner size="md" className="text-blue-500" />
            <span className="text-sm font-medium text-blue-700 dark:text-blue-300">
              {phase === 'starting' ? t('preview.starting')
                : phase === 'installing' ? t('preview.installing')
                : phase}
            </span>
          </div>
        ) : phase === 'error' && previewStatus?.error ? (
          <div className="flex items-center gap-1.5">
            <AlertCircle className="w-4 h-4 text-red-500" />
            <span className="text-sm font-medium text-red-700 dark:text-red-300">{t('preview.startFailed')}</span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-gray-400" />
            <span className="text-sm text-gray-500 dark:text-gray-400">{t('preview.notRunning')}</span>
          </div>
        )}
      </div>

      {/* Control buttons */}
      <div className="flex items-center gap-2">
        {!isRunning && phase !== 'installing' && phase !== 'starting' ? (
          <button
            onClick={onStart}
            disabled={isPreviewLoading || isJobRunning || !(previewStatus?.canStart ?? false)}
            title={isJobRunning ? t('preview.jobRunning', 'Cannot start while a task is running') : !(previewStatus?.canStart ?? false) ? t('preview.cannotStart', 'No runnable project detected') : undefined}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-md
                     bg-green-600 text-white hover:bg-green-700
                     disabled:opacity-50 disabled:cursor-not-allowed
                     transition-colors"
          >
            {isPreviewLoading ? (
              <Spinner size="sm" tone="inherit" />
            ) : (
              <Play className="w-3.5 h-3.5" />
            )}
            {t('preview.start', 'Start')}
          </button>
        ) : (
          <>
            <button
              onClick={onStop}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-md
                       bg-red-600 text-white hover:bg-red-700
                       disabled:opacity-50 disabled:cursor-not-allowed
                       transition-colors"
            >
              {phase === 'stopping' ? (
                <Spinner size="sm" tone="inherit" />
              ) : (
                <Square className="w-3.5 h-3.5" />
              )}
              {phase === 'stopping' ? t('preview.stopping') : t('preview.stop', 'Stop')}
            </button>
            <button
              onClick={onRestart}
              disabled={isPreviewLoading || isJobRunning}
              title={isJobRunning ? t('preview.jobRunning', 'Cannot start while a task is running') : undefined}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-md
                       bg-gray-600 text-white hover:bg-gray-700
                       disabled:opacity-50 disabled:cursor-not-allowed
                       transition-colors"
            >
              <RotateCw className="w-3.5 h-3.5" />
              {t('preview.restart', 'Restart')}
            </button>
          </>
        )}
        {isRunning && isReady && previewStatus?.url && (
          <button
            onClick={onOpenPreview}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-md
                     bg-blue-600 text-white hover:bg-blue-700
                     transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            {t('preview.openPreview', 'Open')}
          </button>
        )}
      </div>

      {/* Error display */}
      {previewStatus?.error && !dismissedSet.has(`error:${previewStatus.error}`) && (
        <div className="mt-3 p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-md">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm text-red-700 dark:text-red-300">{previewStatus.error}</p>
            <button
              onClick={() => onDismissError(`error:${previewStatus.error}`)}
              className="p-0.5 text-red-400 hover:text-red-600 dark:hover:text-red-300 transition-colors flex-shrink-0"
              title="Dismiss"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

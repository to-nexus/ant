import { useTranslation } from 'react-i18next';

export interface ErrorFallbackProps {
  error: Error;
  retry?: () => void;
  compact?: boolean;
}

/**
 * Surface-neutral error state. The RootErrorBoundary (main.tsx) is the last
 * line of defense for uncaught render-phase exceptions; resource-level
 * failures should surface here through the slice's `status: 'error'`.
 */
export function ErrorFallback({ error, retry, compact }: ErrorFallbackProps) {
  const { t } = useTranslation('async');
  return (
    <div className={`h-full w-full flex items-center justify-center ${compact ? 'p-3' : 'p-6'}`}>
      <div className="text-center max-w-md">
        <div className="text-sm font-medium text-red-600 dark:text-red-400">
          {t('error.default')}
        </div>
        <div className="mt-1 text-xs text-gray-500 dark:text-gray-400 break-words">
          {error.message || t('error.default')}
        </div>
        {retry && (
          <button
            type="button"
            onClick={retry}
            className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium
                       bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200
                       hover:bg-gray-200 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-700
                       transition-colors"
          >
            {t('error.retry')}
          </button>
        )}
      </div>
    </div>
  );
}

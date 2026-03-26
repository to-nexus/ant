import { useTranslation } from 'react-i18next';
import { Modal } from './common/Modal';
import type { LaunchPhase } from '@/application/hooks/ui/useDesktopBridge';

const GITHUB_RELEASES_URL = 'https://github.com/anthropics/ant-desktop/releases';

interface DesktopConnectModalProps {
  launchPhase: LaunchPhase;
  onRetry: () => void;
  onCancel: () => void;
}

export function DesktopConnectModal({ launchPhase, onRetry, onCancel }: DesktopConnectModalProps) {
  const { t } = useTranslation('nav');
  const isOpen = launchPhase !== 'idle';

  return (
    <Modal
      isOpen={isOpen}
      onClose={onCancel}
      title="Ant Desktop"
      size="sm"
      onBackdropClick={() => {}}
    >
      <div className="flex flex-col items-center py-4">
        {launchPhase === 'connecting' && (
          <>
            <div className="w-10 h-10 mb-4 border-3 border-gray-200 dark:border-gray-600 border-t-blue-500 rounded-full animate-spin" />
            <p className="text-sm font-medium text-gray-900 dark:text-white mb-1">
              {t('desktop.connecting')}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
              {t('desktop.connectionFailedDesc')}
            </p>
            <button
              onClick={onCancel}
              className="px-4 py-1.5 text-sm font-medium rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              {t('desktop.cancel')}
            </button>
          </>
        )}

        {launchPhase === 'success' && (
          <>
            <div className="w-10 h-10 mb-4 rounded-full bg-green-100 dark:bg-green-900/40 flex items-center justify-center">
              <svg className="w-6 h-6 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="text-sm font-medium text-green-700 dark:text-green-400">
              {t('desktop.connected')}
            </p>
          </>
        )}

        {launchPhase === 'failed' && (
          <>
            <div className="w-10 h-10 mb-4 rounded-full bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center">
              <svg className="w-6 h-6 text-amber-600 dark:text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <p className="text-sm font-medium text-gray-900 dark:text-white mb-1">
              {t('desktop.downloadTitle')}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
              {t('desktop.downloadDesc')}
            </p>
            <div className="flex gap-2">
              <button
                onClick={onRetry}
                className="px-4 py-1.5 text-sm font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700 transition-colors"
              >
                {t('desktop.retry')}
              </button>
              <a
                href={GITHUB_RELEASES_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="px-4 py-1.5 text-sm font-medium rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                {t('desktop.downloadButton')} ↗
              </a>
              <button
                onClick={onCancel}
                className="px-4 py-1.5 text-sm font-medium rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                {t('desktop.cancel')}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

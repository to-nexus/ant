import { useState, useRef, useEffect } from 'react';
import { Settings } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDesktopBridge } from '@/application/hooks/ui/useDesktopBridge';
import { DesktopConnectModal } from './DesktopConnectModal';
import { useStore } from '@/domain/store';
import { GITHUB_RELEASES_URL } from '@/presentation/constants/desktop';
import { AntDesktopIcon } from './common/AntDesktopIcon';

const STATUS_CONFIG = {
  offline: {
    dotClass: 'bg-gray-400',
    iconClass: 'text-gray-400',
    textClass: 'text-gray-500 dark:text-gray-400',
  },
  detected: {
    dotClass: 'bg-amber-500',
    iconClass: 'text-amber-500',
    textClass: 'text-amber-600 dark:text-amber-400',
  },
  connected: {
    dotClass: 'bg-green-500',
    iconClass: 'text-green-500',
    textClass: 'text-green-600 dark:text-green-400',
  },
} as const;

export function DesktopStatusIndicator() {
  const { t } = useTranslation('nav');
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const openMainPanelTab = useStore((s) => s.openMainPanelTab);
  const setOnboardingSkipped = useStore((s) => s.setOnboardingSkipped);
  const setQuickStartProjectId = useStore((s) => s.setQuickStartProjectId);
  const setAccountConfigScrollTarget = useStore((s) => s.setAccountConfigScrollTarget);

  const {
    desktopStatus,
    launchPhase,
    launchDesktop,
    retryLaunch,
    cancelLaunch,
  } = useDesktopBridge({ enablePolling: true });

  const config = STATUS_CONFIG[desktopStatus];

  useEffect(() => {
    if (!showDropdown) return;
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showDropdown]);

  const handleSettingsClick = () => {
    setQuickStartProjectId(undefined);
    setOnboardingSkipped(true);
    openMainPanelTab('accountConfig');
    setAccountConfigScrollTarget('figma');
    setShowDropdown(false);
  };

  const handleActionClick = async () => {
    setShowDropdown(false);
    await launchDesktop();
  };

  return (
    <>
      <div className="relative" ref={dropdownRef}>
        {/* Always-visible indicator button */}
        <button
          onClick={() => setShowDropdown(!showDropdown)}
          className="relative inline-flex items-center gap-1.5 px-1.5 sm:px-2 py-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          title={t(`desktop.${desktopStatus}`)}
        >
          <AntDesktopIcon
            className={`w-4 h-4 ${desktopStatus === 'offline' ? 'text-gray-400' : ''}`}
            muted={desktopStatus === 'offline'}
          />
          <span className={`hidden sm:inline text-xs font-medium ${config.textClass}`}>
            {t(`desktop.${desktopStatus}`)}
          </span>
        </button>

        {/* Dropdown popover */}
        {showDropdown && (
          <div className="absolute top-full right-0 mt-1 w-64 bg-white dark:bg-gray-800
                        rounded-md shadow-lg border border-gray-200 dark:border-gray-700
                        py-2 z-50">
            {/* Status description */}
            <div className="px-3 pb-2 border-b border-gray-100 dark:border-gray-700">
              <div className="flex items-center gap-2 mb-1">
                <span className={`w-2 h-2 rounded-full ${config.dotClass}`} />
                <span className={`text-sm font-medium ${config.textClass}`}>
                  {t(`desktop.${desktopStatus}`)}
                </span>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {t(`desktop.${desktopStatus}Desc`)}
              </p>
            </div>

            {/* Action area */}
            <div className="px-3 py-2">
              {desktopStatus === 'offline' && (
                <div className="space-y-2">
                  <button
                    onClick={handleActionClick}
                    className="w-full px-3 py-1.5 text-sm font-medium rounded-md
                             bg-blue-600 text-white hover:bg-blue-700
                             transition-colors flex items-center justify-center gap-1.5"
                  >
                    <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
                    </svg>
                    {t('desktop.start')}
                  </button>
                  <div className="text-center">
                    <span className="text-xs text-gray-400 dark:text-gray-500">
                      {t('desktop.downloadHint')}{' '}
                    </span>
                    <a
                      href={GITHUB_RELEASES_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      {t('desktop.downloadButton')} ↗
                    </a>
                  </div>
                </div>
              )}

              {desktopStatus === 'detected' && (
                <button
                  onClick={handleActionClick}
                  className="w-full px-3 py-1.5 text-sm font-medium rounded-md
                           bg-blue-600 text-white hover:bg-blue-700
                           transition-colors"
                >
                  {t('desktop.connect')}
                </button>
              )}

              {desktopStatus === 'connected' && (
                <div className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  {t('desktop.connectedDesc')}
                </div>
              )}
            </div>

            {/* Settings link */}
            <div className="border-t border-gray-100 dark:border-gray-700 px-3 pt-2">
              <button
                onClick={handleSettingsClick}
                className="w-full flex items-center gap-1.5 px-2 py-1 text-xs text-gray-500 dark:text-gray-400
                         hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700
                         rounded transition-colors"
              >
                <Settings className="w-3 h-3" />
                {t('desktop.settings')}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Deep link connection modal */}
      <DesktopConnectModal
        launchPhase={launchPhase}
        onRetry={retryLaunch}
        onCancel={cancelLaunch}
      />
    </>
  );
}

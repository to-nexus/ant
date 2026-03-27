import { useState, useRef, useEffect } from 'react';
import { AlertTriangle, Settings } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDesktopBridge } from '@/application/hooks/ui/useDesktopBridge';
import { DesktopConnectModal } from './DesktopConnectModal';
import { useStore } from '@/domain/store';
import { AntDesktopIcon } from './common/AntDesktopIcon';

const STATUS_CONFIG = {
  offline: {
    dotClass: 'bg-gray-400',
    textClass: 'text-gray-500 dark:text-gray-400',
  },
  detected: {
    dotClass: 'bg-amber-500',
    textClass: 'text-amber-600 dark:text-amber-400',
  },
  connected: {
    dotClass: 'bg-green-500',
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

  const figmaDesktopReachable = useStore((s) => s.figmaDesktopReachable);

  const {
    desktopStatus,
    launchPhase,
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
            {/* Status header */}
            <div className="px-3 pb-2 border-b border-gray-100 dark:border-gray-700">
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${config.dotClass}`} />
                <span className={`text-sm font-medium ${config.textClass}`}>
                  {t(`desktop.${desktopStatus}`)}
                </span>
              </div>
            </div>

            {/* Status checklist */}
            <div className="px-3 py-2 space-y-1.5">
              {desktopStatus === 'offline' && (
                <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-gray-400 flex-shrink-0" />
                  {t('desktop.antDesktopOffline')}
                </div>
              )}

              {desktopStatus === 'detected' && (
                <div className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                  {t('desktop.antDesktopDetected')}
                </div>
              )}

              {desktopStatus === 'connected' && (
                <>
                  <div className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400">
                    <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                    {t('desktop.antDesktopConnected')}
                  </div>
                  <div className={`flex items-center gap-1.5 text-xs ${figmaDesktopReachable ? 'text-green-600 dark:text-green-400' : 'text-amber-600 dark:text-amber-400'}`}>
                    {figmaDesktopReachable ? (
                      <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    ) : (
                      <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                    )}
                    {figmaDesktopReachable ? t('desktop.figmaConnected') : t('desktop.figmaNotReachable')}
                  </div>
                </>
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

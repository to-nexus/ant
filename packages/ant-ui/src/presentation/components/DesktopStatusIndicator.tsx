import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useDesktopBridge } from '@/application/hooks/ui/useDesktopBridge';
import { DesktopConnectModal } from './DesktopConnectModal';
import { useStore } from '@/domain/store';
import { AntDesktopIcon } from './common/AntDesktopIcon';
import { Icon } from './aurora/Icon';

const STATUS_CONFIG = {
  offline: {
    dotBg: 'var(--text-4)',
    textColor: 'var(--text-3)',
  },
  detected: {
    dotBg: 'var(--orange-500)',
    textColor: 'var(--orange-600)',
  },
  connected: {
    dotBg: 'var(--emerald-500)',
    textColor: 'var(--emerald-500)',
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
          className="relative inline-flex items-center gap-1.5 px-1.5 sm:px-2 py-1.5"
          style={{
            background: 'transparent',
            borderRadius: 'var(--r-md)',
            transition: 'background var(--dur-fast) var(--ease-smooth)',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--bg-hover)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
          }}
          title={t(`desktop.${desktopStatus}`)}
        >
          <AntDesktopIcon
            className="w-4 h-4"
            muted={desktopStatus === 'offline'}
            style={desktopStatus === 'offline' ? { color: 'var(--text-4)' } : undefined}
          />
          <span
            className="hidden sm:inline text-xs font-medium"
            style={{ color: config.textColor }}
          >
            {t(`desktop.${desktopStatus}`)}
          </span>
        </button>

        {/* Dropdown popover */}
        {showDropdown && (
          <div
            className="absolute top-full right-0 mt-1 w-64 py-2 z-50"
            style={{
              background: 'var(--bg-surface)',
              border: '1px solid var(--border-2)',
              borderRadius: 'var(--r-md)',
              boxShadow: 'var(--shadow-md)',
            }}
          >
            {/* Status header */}
            <div
              className="px-3 pb-2"
              style={{ borderBottom: '1px solid var(--border-1)' }}
            >
              <div className="flex items-center gap-2">
                <span
                  className="w-2 h-2 rounded-full"
                  style={{
                    background: config.dotBg,
                    animation:
                      desktopStatus === 'connected'
                        ? 'pulse-soft 2.4s ease-in-out infinite'
                        : undefined,
                  }}
                />
                <span
                  className="text-sm font-medium"
                  style={{ color: config.textColor }}
                >
                  {t(`desktop.${desktopStatus}`)}
                </span>
              </div>
            </div>

            {/* Status checklist */}
            <div className="px-3 py-2 space-y-1.5">
              {desktopStatus === 'offline' && (
                <div
                  className="flex items-center gap-1.5 text-xs"
                  style={{ color: 'var(--text-3)' }}
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                    style={{ background: 'var(--text-4)' }}
                  />
                  {t('desktop.antDesktopOffline')}
                </div>
              )}

              {desktopStatus === 'detected' && (
                <div
                  className="flex items-center gap-1.5 text-xs"
                  style={{ color: 'var(--orange-600)' }}
                >
                  <Icon name="alert-triangle" size={14} style={{ flexShrink: 0 }} />
                  {t('desktop.antDesktopDetected')}
                </div>
              )}

              {desktopStatus === 'connected' && (
                <>
                  <div
                    className="flex items-center gap-1.5 text-xs"
                    style={{ color: 'var(--emerald-500)' }}
                  >
                    <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                    {t('desktop.antDesktopConnected')}
                  </div>
                  <div
                    className="flex items-center gap-1.5 text-xs"
                    style={{
                      color: figmaDesktopReachable
                        ? 'var(--emerald-500)'
                        : 'var(--orange-600)',
                    }}
                  >
                    {figmaDesktopReachable ? (
                      <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    ) : (
                      <Icon name="alert-triangle" size={14} style={{ flexShrink: 0 }} />
                    )}
                    {figmaDesktopReachable ? t('desktop.figmaConnected') : t('desktop.figmaNotReachable')}
                  </div>
                </>
              )}
            </div>

            {/* Settings link */}
            <div
              className="px-3 pt-2"
              style={{ borderTop: '1px solid var(--border-1)' }}
            >
              <button
                onClick={handleSettingsClick}
                className="w-full flex items-center gap-1.5 px-2 py-1 text-xs"
                style={{
                  color: 'var(--text-3)',
                  borderRadius: 'var(--r-sm)',
                  transition:
                    'background var(--dur-fast) var(--ease-smooth), color var(--dur-fast) var(--ease-smooth)',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'var(--bg-hover)';
                  e.currentTarget.style.color = 'var(--text-2)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.color = 'var(--text-3)';
                }}
              >
                <Icon name="settings" size={12} />
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

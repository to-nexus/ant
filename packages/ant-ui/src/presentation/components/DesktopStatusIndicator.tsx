import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useDesktopBridge } from '@/application/hooks/ui/useDesktopBridge';
import { DesktopConnectModal } from './DesktopConnectModal';
import { useStore } from '@/domain/store';
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
        {/* Always-visible indicator button — compact pill chip (handoff: shared.jsx DesktopStatusIndicator) */}
        <button
          onClick={() => setShowDropdown(!showDropdown)}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 10px',
            borderRadius: 999,
            background: 'var(--bg-surface-2)',
            border: '1px solid var(--border-2)',
            fontSize: 11,
            fontWeight: 500,
            color: 'var(--text-2)',
            cursor: 'pointer',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--bg-hover)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'var(--bg-surface-2)';
          }}
          title={t(`desktop.${desktopStatus}`)}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: config.dotBg,
              animation:
                desktopStatus === 'connected'
                  ? 'pulse-soft 2.4s ease-in-out infinite'
                  : 'none',
              flexShrink: 0,
            }}
          />
          <span
            className="hidden sm:inline"
            style={{ fontSize: 11, fontWeight: 500, color: config.textColor }}
          >
            {t(`desktop.${desktopStatus}`)}
          </span>
          <Icon name="cube" size={11} style={{ color: 'var(--text-3)' }} />
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

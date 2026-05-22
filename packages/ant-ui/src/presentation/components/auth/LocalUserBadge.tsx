import { Monitor, User, ChevronDown } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/domain/store';

/**
 * GNB user surface for `serverMode === 'local'`.
 *
 * Replaces the Sign In/Up + User dropdown that the cloud surface shows.
 * Local-mode backends have no remote identity — we simply expose Account
 * Configuration so the user can still reach LLM keys / model defaults.
 */
export function LocalUserBadge() {
  const { t } = useTranslation('nav');
  const openMainPanelTab = useStore((s) => s.openMainPanelTab);
  const setOnboardingSkipped = useStore((s) => s.setOnboardingSkipped);
  const setQuickStartProjectId = useStore((s) => s.setQuickStartProjectId);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        title={t('serverMode.localUserTooltip')}
        className="flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-1.5"
        style={{
          background: 'var(--bg-surface-2)',
          border: '1px solid var(--border-2)',
          borderRadius: 'var(--r-md)',
          transition: 'background var(--dur-fast) var(--ease-smooth)',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'var(--bg-hover)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'var(--bg-surface-2)';
        }}
      >
        <Monitor className="w-4 h-4" style={{ color: 'var(--emerald-500)' }} />
        <span
          className="hidden md:inline text-xs font-medium"
          style={{ color: 'var(--text-3)' }}
        >
          {t('serverMode.localOrg')}
        </span>
        <span
          className="hidden sm:inline text-xs font-semibold"
          style={{ color: 'var(--text-1)' }}
        >
          {t('serverMode.localUser')}
        </span>
        <ChevronDown className="w-3 h-3" style={{ color: 'var(--text-3)' }} />
      </button>

      {open && (
        <div
          className="absolute top-full right-0 mt-2 w-56 py-1 z-50"
          style={{
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-2)',
            borderRadius: 'var(--r-md)',
            boxShadow: 'var(--shadow-md)',
          }}
        >
          <button
            onClick={() => {
              setQuickStartProjectId(undefined);
              setOnboardingSkipped(true);
              openMainPanelTab('accountConfig');
              setOpen(false);
            }}
            className="w-full px-4 py-2 text-left text-sm flex items-center gap-2"
            style={{
              color: 'var(--text-2)',
              transition: 'background var(--dur-fast) var(--ease-smooth)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--bg-hover)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
            }}
          >
            <User className="w-4 h-4" />
            {t('auth.accountConfig')}
          </button>
        </div>
      )}
    </div>
  );
}

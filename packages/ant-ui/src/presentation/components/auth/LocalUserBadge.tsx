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
        className="flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-1.5 rounded-md
                   bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700
                   transition-colors"
      >
        <Monitor className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
        <span className="hidden md:inline text-xs font-medium text-gray-500 dark:text-gray-400">
          {t('serverMode.localOrg')}
        </span>
        <span className="hidden sm:inline text-xs font-semibold text-gray-900 dark:text-white">
          {t('serverMode.localUser')}
        </span>
        <ChevronDown className="w-3 h-3 text-gray-500 dark:text-gray-400" />
      </button>

      {open && (
        <div className="absolute top-full right-0 mt-2 w-56 bg-white dark:bg-gray-800
                        rounded-md shadow-lg border border-gray-200 dark:border-gray-700
                        py-1 z-50">
          <button
            onClick={() => {
              setQuickStartProjectId(undefined);
              setOnboardingSkipped(true);
              openMainPanelTab('accountConfig');
              setOpen(false);
            }}
            className="w-full px-4 py-2 text-left text-sm text-gray-700 dark:text-gray-300
                       hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2
                       transition-colors"
          >
            <User className="w-4 h-4" />
            {t('auth.accountConfig')}
          </button>
        </div>
      )}
    </div>
  );
}

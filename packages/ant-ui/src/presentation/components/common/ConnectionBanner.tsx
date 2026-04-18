import { Spinner } from './async';
import { useTranslation } from 'react-i18next';

interface ConnectionBannerProps {
  visible: boolean;
}

/**
 * Non-dismissable banner shown at the top of the screen while the app is
 * trying to reconnect to the backend.  No close button, no ESC, no backdrop
 * click -- it disappears only when the health-check resolves.
 */
export function ConnectionBanner({ visible }: ConnectionBannerProps) {
  const { t } = useTranslation('common');

  if (!visible) return null;

  return (
    <div
      className="fixed top-0 left-0 right-0 z-[9998] flex items-center justify-center gap-2
                 h-10 bg-amber-50 dark:bg-amber-900/30 border-b border-amber-200 dark:border-amber-700
                 text-amber-800 dark:text-amber-200 text-sm font-medium
                 animate-fadeIn select-none"
    >
      <Spinner size="md" tone="inherit" />
      <span>{t('serverDown.connecting', 'Trying to reconnect to server...')}</span>
    </div>
  );
}

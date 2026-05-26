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
                 text-amber-800 text-sm font-medium
                 animate-fadeIn select-none"
      style={{
        height: 40,
        background: 'var(--amber-50)',
        borderBottom: '1px solid var(--amber-300)',
      }}
    >
      <Spinner size="md" tone="inherit" />
      <span>{t('serverDown.connecting', 'Trying to reconnect to server...')}</span>
    </div>
  );
}

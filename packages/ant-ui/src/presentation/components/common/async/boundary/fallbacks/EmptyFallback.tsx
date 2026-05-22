import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

export interface EmptyFallbackProps {
  title?: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
}

/**
 * Surface-neutral empty state. Intentionally distinct from loading — the
 * two must never share rendering.
 */
export function EmptyFallback({ title, description, icon, action }: EmptyFallbackProps) {
  const { t } = useTranslation('async');
  return (
    <div className="h-full w-full flex items-center justify-center p-6">
      <div className="text-center max-w-sm text-[color:var(--text-3)]">
        {icon && <div className="mb-3 flex justify-center">{icon}</div>}
        <div className="text-sm">{description ?? title ?? t('empty.default')}</div>
        {action && <div className="mt-3">{action}</div>}
      </div>
    </div>
  );
}

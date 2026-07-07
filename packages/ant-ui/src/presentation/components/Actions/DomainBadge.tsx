import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Globe, ArrowUpRight } from 'lucide-react';
import { useStore } from '@/domain/store';
import { Tooltip } from '@/presentation/components/common/Tooltip';

interface DomainBadgeProps {
  /**
   * Navigation to the top level where the domain can actually be changed.
   * Chat passes `() => openActionsPanel()`. Page screens omit it and get the
   * default `() => setActionsStep('pick-action')`.
   */
  onGoToTopLevel?: () => void;
  className?: string;
}

/**
 * Compact, read-only indicator of the current workspace domain
 * (`actionMetadata.domain`). The badge itself is a click trigger: clicking it
 * opens a small tooltip explaining that the domain is chosen on the top screen,
 * with a link that navigates there. The interactive selector remains
 * `DomainToggle`, rendered only on the ActionsPanel top (`pick-action`).
 */
export function DomainBadge({ onGoToTopLevel, className }: DomainBadgeProps) {
  const { t } = useTranslation('actions');
  const domain = useStore(s => s.actionMetadata).domain ?? 'service';
  const setActionsStep = useStore(s => s.setActionsStep);

  const goToTopLevel = useCallback(() => {
    if (onGoToTopLevel) onGoToTopLevel();
    else setActionsStep('pick-action');
  }, [onGoToTopLevel, setActionsStep]);

  const content = (
    <div className="flex flex-col gap-1.5 max-w-[15rem]">
      <span className="text-xs" style={{ color: 'var(--text-2)' }}>
        {t('domain.badge.hint')}
      </span>
      <button
        type="button"
        onClick={goToTopLevel}
        className="inline-flex items-center gap-1 text-xs font-medium self-start"
        style={{ color: 'var(--violet-600)' }}
      >
        <ArrowUpRight className="w-3 h-3 shrink-0" />
        {t('domain.badge.goToTopLevel')}
      </button>
    </div>
  );

  return (
    <Tooltip content={content} placement="bottom">
      <span
        role="button"
        aria-label={t('domain.badge.aria') as string}
        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium shrink-0 ${className ?? ''}`}
        style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-2)',
          color: 'var(--text-2)',
        }}
      >
        <Globe className="w-3 h-3 shrink-0" style={{ color: 'var(--blue-500)' }} />
        {t(`domain.toggle.option.${domain}`)}
      </span>
    </Tooltip>
  );
}

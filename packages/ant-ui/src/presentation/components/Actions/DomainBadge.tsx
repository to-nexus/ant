import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Globe, Bot, ArrowUpRight } from 'lucide-react';
import { useStore } from '@/domain/store';
import { Tooltip } from '@/presentation/components/common/Tooltip';

interface DomainBadgeProps {
  className?: string;
}

/**
 * Compact, read-only indicator of the current project domain
 * (`actionMetadata.domain`, mirrored from the project's `config.json`).
 * Domain is a project-level property changed only at project creation or in
 * project settings — the badge itself never switches it. Its tooltip carries
 * a link that opens project settings (`projectConfig` main-panel tab) where
 * the domain can actually be changed.
 *
 * Universal workspaces have no domain — projectType (not a domain) takes the
 * badge's slot as a read-only creation-time fact, with its own copy so the
 * two axes never share vocabulary.
 */
export function DomainBadge({ className }: DomainBadgeProps) {
  const { t } = useTranslation('actions');
  const domain = useStore(s => s.actionMetadata).domain ?? 'service';
  const isUniversal = useStore(s => s.projectType) === 'universal';
  const openMainPanelTab = useStore(s => s.openMainPanelTab);

  const openSettings = useCallback(
    () => openMainPanelTab('projectConfig'),
    [openMainPanelTab],
  );

  const content = (
    <div className="flex flex-col gap-1.5 max-w-[15rem]">
      <span className="text-xs" style={{ color: 'var(--text-2)' }}>
        {isUniversal ? t('projectType.badge.hint') : t('domain.badge.hint')}
      </span>
      <button
        type="button"
        onClick={openSettings}
        className="inline-flex items-center gap-1 text-xs font-medium self-start"
        style={{ color: 'var(--violet-600)' }}
      >
        <ArrowUpRight className="w-3 h-3 shrink-0" />
        {t('domain.badge.openSettings')}
      </button>
    </div>
  );

  return (
    <Tooltip content={content} placement="bottom">
      <span
        role="button"
        aria-label={(isUniversal ? t('projectType.badge.aria') : t('domain.badge.aria')) as string}
        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium shrink-0 ${className ?? ''}`}
        style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-2)',
          color: 'var(--text-2)',
        }}
      >
        {isUniversal ? (
          <Bot className="w-3 h-3 shrink-0" style={{ color: 'var(--pink-500, oklch(70% 0.2 350))' }} />
        ) : (
          <Globe className="w-3 h-3 shrink-0" style={{ color: 'var(--blue-500)' }} />
        )}
        {isUniversal ? t('projectType.badge.label') : t(`domain.toggle.option.${domain}`)}
      </span>
    </Tooltip>
  );
}

import { useTranslation } from 'react-i18next';
import { Download, Plus, Upload, Download as DownloadIcon, RefreshCw, Globe } from 'lucide-react';
import type { GitMenu } from '@/domain/git-world';

interface MenuDropdownProps {
  menu: GitMenu;
  handleClone: () => void;
  handleInitialize: () => void;
  handlePublish: () => void;
  handlePush: () => void;
  handlePull: () => void;
  handleFetch: () => void;
}

/**
 * Secondary-action dropdown content. Pure render of the `GitMenu`
 * discriminated union returned by `useGitMenu` — every branch picks a
 * fixed subset of actions with no additional branching on snapshot
 * fields. This is the sister UI to `ActionButton`; both are driven by
 * the same `GitSnapshot` through sibling selectors, which is what keeps
 * them consistent by construction.
 */
export function MenuDropdown({
  menu,
  handleClone,
  handleInitialize,
  handlePublish,
  handlePush,
  handlePull,
  handleFetch,
}: MenuDropdownProps) {
  const { t } = useTranslation('explorer');

  const dropdownStyle: React.CSSProperties = {
    background: 'var(--surface-2)',
    border: '1px solid var(--border-1)',
    boxShadow: 'var(--shadow-2, var(--shadow-1))',
    color: 'var(--text-1)',
  };

  const renderItem = (params: {
    onClick?: () => void;
    icon: React.ReactNode;
    title: string;
    desc: string;
    disabled?: boolean;
    withDivider?: boolean;
    titleAttr?: string;
  }) => {
    const { onClick, icon, title, desc, disabled, withDivider, titleAttr } = params;
    return (
      <button
        onClick={disabled ? undefined : onClick}
        disabled={!!disabled}
        title={titleAttr}
        className="w-full px-3 py-2 text-left text-sm flex items-center gap-2 transition-colors"
        style={{
          color: 'var(--text-1)',
          background: 'transparent',
          borderBottom: withDivider ? '1px solid var(--border-1)' : 'none',
          opacity: disabled ? 0.4 : 1,
          cursor: disabled ? 'not-allowed' : 'pointer',
        }}
        onMouseEnter={(e) => {
          if (disabled) return;
          (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-hover)';
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
        }}
      >
        {icon}
        <div>
          <div className="font-medium">{title}</div>
          <div className="text-xs" style={{ color: 'var(--text-3)' }}>{desc}</div>
        </div>
      </button>
    );
  };

  return (
    <div
      className="absolute top-full right-0 mt-1 w-56 rounded-md z-[9999] overflow-hidden"
      style={dropdownStyle}
    >
      {menu.kind === 'loading' && (
        <div className="px-3 py-2 text-xs" style={{ color: 'var(--text-3)' }}>
          {t('common:status.checking')}
        </div>
      )}
      {menu.kind === 'disabled' && (
        <div className="px-3 py-2 text-xs" style={{ color: 'var(--text-3)' }}>
          {t('config:git.repoSetupRequired')}
        </div>
      )}
      {menu.kind === 'publish' && renderItem({
        onClick: menu.source === 'noFeatures' ? handlePublish : handlePush,
        icon: <Globe className="w-4 h-4" />,
        title: t('config:git.publish'),
        desc: menu.source === 'noFeatures'
          ? t('config:git.publishToGitHubDesc')
          : t('config:git.publishDesc'),
      })}
      {menu.kind === 'setup' && (() => {
        const action = menu.actions[0] ?? 'ambiguous';
        const showClone = action === 'clone' || action === 'ambiguous';
        const showInitialize = action === 'publish' || action === 'ambiguous';
        return (
          <>
            {showClone && renderItem({
              onClick: handleClone,
              icon: <Download className="w-4 h-4" />,
              title: t('config:git.clone'),
              desc: t('config:git.cloneDesc'),
              withDivider: showInitialize,
            })}
            {showInitialize && renderItem({
              onClick: handleInitialize,
              icon: <Plus className="w-4 h-4" />,
              title: t('config:git.initialize'),
              desc: t('config:git.initializeDesc'),
            })}
          </>
        );
      })()}
      {menu.kind === 'synced' && (
        <>
          {renderItem({
            onClick: handlePush,
            icon: <Upload className="w-4 h-4" />,
            title: t('config:git.push'),
            desc: t('config:git.pushDesc'),
            disabled: !menu.canPush,
            withDivider: true,
          })}
          {renderItem({
            onClick: handlePull,
            icon: <DownloadIcon className="w-4 h-4" />,
            title: t('config:git.pull'),
            desc: menu.pullBlockedByChanges ? t('git.commitFirstToPull') : t('config:git.pullDesc'),
            disabled: !menu.canPull,
            withDivider: true,
            titleAttr: menu.pullBlockedByChanges ? t('git.commitFirstToPull') : undefined,
          })}
          {renderItem({
            onClick: handleFetch,
            icon: <RefreshCw className="w-4 h-4" />,
            title: t('config:git.fetch'),
            desc: t('config:git.fetchDesc'),
          })}
        </>
      )}
    </div>
  );
}

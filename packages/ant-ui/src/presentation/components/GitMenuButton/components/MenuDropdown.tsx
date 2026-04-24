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
  const disabledClass = 'opacity-40 cursor-not-allowed';
  const enabledClass = 'hover:bg-gray-100 dark:hover:bg-gray-700';

  return (
    <div className="absolute top-full right-0 mt-1 w-56 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md shadow-lg z-[9999]">
      {menu.kind === 'loading' && (
        <div className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400">
          {t('common:status.checking')}
        </div>
      )}
      {menu.kind === 'disabled' && (
        <div className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400">
          {t('config:git.repoSetupRequired')}
        </div>
      )}
      {menu.kind === 'publish' && (
        <button
          onClick={menu.source === 'noFeatures' ? handlePublish : handlePush}
          className="w-full px-3 py-2 text-left text-sm flex items-center gap-2 text-gray-900 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700"
        >
          <Globe className="w-4 h-4" />
          <div>
            <div className="font-medium">{t('config:git.publish')}</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">
              {menu.source === 'noFeatures'
                ? t('config:git.publishToGitHubDesc')
                : t('config:git.publishDesc')}
            </div>
          </div>
        </button>
      )}
      {menu.kind === 'setup' && (() => {
        const action = menu.actions[0] ?? 'ambiguous';
        const showClone = action === 'clone' || action === 'ambiguous';
        const showInitialize = action === 'publish' || action === 'ambiguous';
        return (
          <>
            {showClone && (
              <button
                onClick={handleClone}
                className={`w-full px-3 py-2 text-left text-sm flex items-center gap-2 ${showInitialize ? 'border-b border-gray-200 dark:border-gray-700' : ''} text-gray-900 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700`}
              >
                <Download className="w-4 h-4" />
                <div>
                  <div className="font-medium">{t('config:git.clone')}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">{t('config:git.cloneDesc')}</div>
                </div>
              </button>
            )}
            {showInitialize && (
              <button
                onClick={handleInitialize}
                className="w-full px-3 py-2 text-left text-sm flex items-center gap-2 text-gray-900 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                <Plus className="w-4 h-4" />
                <div>
                  <div className="font-medium">{t('config:git.initialize')}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">{t('config:git.initializeDesc')}</div>
                </div>
              </button>
            )}
          </>
        );
      })()}
      {menu.kind === 'synced' && (
        <>
          <button
            onClick={menu.canPush ? handlePush : undefined}
            className={`w-full px-3 py-2 text-left text-sm flex items-center gap-2 border-b border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-100 ${menu.canPush ? enabledClass : disabledClass}`}
            disabled={!menu.canPush}
          >
            <Upload className="w-4 h-4" />
            <div>
              <div className="font-medium">{t('config:git.push')}</div>
              <div className="text-xs text-gray-500 dark:text-gray-400">{t('config:git.pushDesc')}</div>
            </div>
          </button>
          <button
            onClick={menu.canPull ? handlePull : undefined}
            className={`w-full px-3 py-2 text-left text-sm flex items-center gap-2 border-b border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-100 ${menu.canPull ? enabledClass : disabledClass}`}
            disabled={!menu.canPull}
            title={menu.pullBlockedByChanges ? t('git.commitFirstToPull') : undefined}
          >
            <DownloadIcon className="w-4 h-4" />
            <div>
              <div className="font-medium">{t('config:git.pull')}</div>
              <div className="text-xs text-gray-500 dark:text-gray-400">
                {menu.pullBlockedByChanges ? t('git.commitFirstToPull') : t('config:git.pullDesc')}
              </div>
            </div>
          </button>
          <button
            onClick={handleFetch}
            className={`w-full px-3 py-2 text-left text-sm flex items-center gap-2 text-gray-900 dark:text-gray-100 ${enabledClass}`}
          >
            <RefreshCw className="w-4 h-4" />
            <div>
              <div className="font-medium">{t('config:git.fetch')}</div>
              <div className="text-xs text-gray-500 dark:text-gray-400">{t('config:git.fetchDesc')}</div>
            </div>
          </button>
        </>
      )}
    </div>
  );
}

import { useTranslation } from 'react-i18next';
import { GitCommit, Upload, Download, RefreshCw, Check, Globe } from 'lucide-react';
import { Button } from '../../common/button';
import { GitChanges } from '../hooks/useGitChanges';
import { useStore } from '@/domain/store';

interface ActionButtonProps {
  gitChanges: GitChanges;
  isCommitting: boolean;
  isPushing: boolean;
  isPulling: boolean;
  isSyncing: boolean;
  onCommit: (files?: string[]) => void;
  onPush: () => void;
  onPull: () => void;
  onSync: () => void;
  selectedFiles?: string[];
}

export function ActionButton({
  gitChanges,
  isCommitting,
  isPushing,
  isPulling,
  isSyncing,
  onCommit,
  onPush,
  onPull,
  onSync,
  selectedFiles
}: ActionButtonProps) {
  const { t } = useTranslation('explorer');
  const isGitStatusLoading = useStore((state) => state.isGitStatusLoading);
  const totalChanges = gitChanges.staged.length + gitChanges.unstaged.length + gitChanges.untracked.length;

  const actionButtonClass = `flex-1 flex items-center justify-center gap-2 px-3 py-1.5 text-xs font-medium
                     bg-emerald-500/10 dark:bg-emerald-500/10 
                     border-emerald-500/30 dark:border-emerald-500/30
                     hover:bg-emerald-500/20 dark:hover:bg-emerald-500/20
                     text-emerald-600 dark:text-emerald-400
                     transition-colors`;

  // Priority 1: Commit (has uncommitted changes)
  if (totalChanges > 0) {
    const commitCount = selectedFiles ? selectedFiles.length : totalChanges;
    return (
      <div className="flex items-center flex-1 min-w-0">
        <Button
          onClick={() => onCommit(selectedFiles)}
          variant="outline"
          size="sm"
          className="flex-1 flex items-center gap-2 px-3 py-1.5 text-xs font-medium min-w-0
                     bg-emerald-500/10 dark:bg-emerald-500/10 
                     border-emerald-500/30 dark:border-emerald-500/30
                     hover:bg-emerald-500/20 dark:hover:bg-emerald-500/20
                     text-emerald-600 dark:text-emerald-400
                     transition-colors"
          disabled={isCommitting || isGitStatusLoading || (selectedFiles !== undefined && selectedFiles.length === 0)}
          title={isGitStatusLoading ? t('git.updatingStatus') : undefined}
        >
          <GitCommit className="w-3.5 h-3.5 flex-shrink-0" />
          {isCommitting ? (
            <span className="truncate">{t('git.committing')}</span>
          ) : (
            <>
              <span className="truncate">{t('git.commitAction')}</span>
              <span className="flex-shrink-0 tabular-nums">{commitCount}</span>
            </>
          )}
        </Button>
      </div>
    );
  }

  // Priority 2: Publish Branch (no upstream set)
  if (gitChanges.hasUpstream === false) {
    return (
      <div className="flex items-center flex-1">
        <Button
          onClick={onPush}
          variant="outline"
          size="sm"
          className={actionButtonClass}
          disabled={isPushing || isGitStatusLoading}
          title={t('git.publishBranchDesc')}
        >
          <Globe className="w-3.5 h-3.5" />
          {isPushing ? t('git.publishing') : t('git.publishBranch')}
        </Button>
      </div>
    );
  }

  // Priority 3: Sync (ahead and behind)
  if (gitChanges.ahead > 0 && gitChanges.behind > 0) {
    return (
      <div className="flex items-center flex-1">
        <Button
          onClick={onSync}
          variant="outline"
          size="sm"
          className={actionButtonClass}
          disabled={isSyncing || isGitStatusLoading}
          title={isGitStatusLoading ? t('git.updatingStatus') : t('git.pullThenPush')}
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
          {isSyncing ? (
            t('git.syncingFromRemote')
          ) : (
            <span className="flex items-center gap-2">
              {t('git.sync')}
              <span className="flex items-center gap-1">
                <Upload className="w-3 h-3" />
                {gitChanges.ahead}
              </span>
              <span className="flex items-center gap-1">
                <Download className="w-3 h-3" />
                {gitChanges.behind}
              </span>
            </span>
          )}
        </Button>
      </div>
    );
  }

  // Priority 4: Push
  if (gitChanges.ahead > 0) {
    return (
      <div className="flex items-center flex-1">
        <Button
          onClick={onPush}
          variant="outline"
          size="sm"
          className={actionButtonClass}
          disabled={isPushing || isGitStatusLoading}
          title={isGitStatusLoading ? t('git.updatingStatus') : undefined}
        >
          {isPushing ? (
            <span className="flex items-center gap-1.5">
              <Upload className="w-3.5 h-3.5" />
              {t('git.pushingCommits', { count: gitChanges.ahead, commits: gitChanges.ahead === 1 ? t('git.commit') : t('git.commits') })}
            </span>
          ) : (
            <span className="flex items-center gap-1.5">
              {t('config:git.push')}
              <Upload className="w-3 h-3" />
              {gitChanges.ahead}
            </span>
          )}
        </Button>
      </div>
    );
  }

  // Priority 5: Pull
  if (gitChanges.behind > 0) {
    return (
      <div className="flex items-center flex-1">
        <Button
          onClick={onPull}
          variant="outline"
          size="sm"
          className={actionButtonClass}
          disabled={isPulling || isGitStatusLoading}
          title={isGitStatusLoading ? t('git.updatingStatus') : undefined}
        >
          {isPulling ? (
            <span className="flex items-center gap-1.5">
              <Download className="w-3.5 h-3.5" />
              {t('git.pullingFromRemote')}
            </span>
          ) : (
            <span className="flex items-center gap-1.5">
              {t('config:git.pull')}
              <Download className="w-3 h-3" />
              {gitChanges.behind}
            </span>
          )}
        </Button>
      </div>
    );
  }

  // Priority 6: No changes
  return (
    <div className="flex items-center flex-1">
      <Button
        variant="outline"
        size="sm"
        disabled
        className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium
                   opacity-50 cursor-default
                   text-gray-600 dark:text-gray-400
                   border-gray-300 dark:border-gray-600
                   bg-gray-50 dark:bg-gray-800/50"
      >
        <Check className="w-3.5 h-3.5" />
        <span>{t('git.noChanges')}</span>
      </Button>
    </div>
  );
}

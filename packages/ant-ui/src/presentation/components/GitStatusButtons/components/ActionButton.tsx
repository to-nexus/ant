import { GitCommit, Upload, Download, RefreshCw, Check } from 'lucide-react';
import { Button } from '../../common/button';
import { GitChanges } from '../hooks/useGitChanges';
import { useStore } from '@/domain/store';

interface ActionButtonProps {
  gitChanges: GitChanges;
  isCommitting: boolean;
  isPushing: boolean;
  isPulling: boolean;
  isSyncing: boolean;
  onCommit: () => void;
  onPush: () => void;
  onPull: () => void;
  onSync: () => void;
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
  onSync
}: ActionButtonProps) {
  const isGitStatusLoading = useStore((state) => state.isGitStatusLoading);
  const totalChanges = gitChanges.staged.length + gitChanges.unstaged.length + gitChanges.untracked.length;

  // Priority 1: Commit
  if (totalChanges > 0) {
    return (
      <div className="flex items-center flex-1">
        <Button
          onClick={onCommit}
          variant="outline"
          size="sm"
          className="flex-1 flex items-center justify-center gap-2 px-3 py-1.5 text-xs font-medium
                     bg-emerald-500/10 dark:bg-emerald-500/10 
                     border-emerald-500/30 dark:border-emerald-500/30
                     hover:bg-emerald-500/20 dark:hover:bg-emerald-500/20
                     text-emerald-600 dark:text-emerald-400
                     transition-colors"
          disabled={isCommitting || isGitStatusLoading}
          title={isGitStatusLoading ? 'Updating Git status...' : undefined}
        >
          <GitCommit className="w-3.5 h-3.5" />
          {isCommitting ? (
            'Committing...'
          ) : (
            <span>Commit ({totalChanges}) {totalChanges === 1 ? 'file' : 'files'}</span>
          )}
        </Button>
      </div>
    );
  }

  // Priority 2: Sync
  if (gitChanges.ahead > 0 && gitChanges.behind > 0) {
    return (
      <div className="flex items-center flex-1">
        <Button
          onClick={onSync}
          variant="outline"
          size="sm"
          className="flex-1 flex items-center justify-center gap-2 px-3 py-1.5 text-xs font-medium
                     bg-emerald-500/10 dark:bg-emerald-500/10 
                     border-emerald-500/30 dark:border-emerald-500/30
                     hover:bg-emerald-500/20 dark:hover:bg-emerald-500/20
                     text-emerald-600 dark:text-emerald-400
                     transition-colors"
          disabled={isSyncing || isGitStatusLoading}
          title={isGitStatusLoading ? 'Updating Git status...' : 'Pull then push'}
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
          {isSyncing ? (
            'Syncing from remote'
          ) : (
            <span className="flex items-center gap-2">
              Sync
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

  // Priority 3: Push
  if (gitChanges.ahead > 0) {
    return (
      <div className="flex items-center flex-1">
        <Button
          onClick={onPush}
          variant="outline"
          size="sm"
          className="flex-1 flex items-center justify-center gap-2 px-3 py-1.5 text-xs font-medium
                     bg-emerald-500/10 dark:bg-emerald-500/10 
                     border-emerald-500/30 dark:border-emerald-500/30
                     hover:bg-emerald-500/20 dark:hover:bg-emerald-500/20
                     text-emerald-600 dark:text-emerald-400
                     transition-colors"
          disabled={isPushing || isGitStatusLoading}
          title={isGitStatusLoading ? 'Updating Git status...' : undefined}
        >
          {isPushing ? (
            <span className="flex items-center gap-1.5">
              <Upload className="w-3.5 h-3.5" />
              Pushing {gitChanges.ahead} {gitChanges.ahead === 1 ? 'commit' : 'commits'}
            </span>
          ) : (
            <span className="flex items-center gap-1.5">
              Push
              <Upload className="w-3 h-3" />
              {gitChanges.ahead}
            </span>
          )}
        </Button>
      </div>
    );
  }

  // Priority 4: Pull
  if (gitChanges.behind > 0) {
    return (
      <div className="flex items-center flex-1">
        <Button
          onClick={onPull}
          variant="outline"
          size="sm"
          className="flex-1 flex items-center justify-center gap-2 px-3 py-1.5 text-xs font-medium
                     bg-emerald-500/10 dark:bg-emerald-500/10 
                     border-emerald-500/30 dark:border-emerald-500/30
                     hover:bg-emerald-500/20 dark:hover:bg-emerald-500/20
                     text-emerald-600 dark:text-emerald-400
                     transition-colors"
          disabled={isPulling || isGitStatusLoading}
          title={isGitStatusLoading ? 'Updating Git status...' : undefined}
        >
          {isPulling ? (
            <span className="flex items-center gap-1.5">
              <Download className="w-3.5 h-3.5" />
              Pulling from remote
            </span>
          ) : (
            <span className="flex items-center gap-1.5">
              Pull
              <Download className="w-3 h-3" />
              {gitChanges.behind}
            </span>
          )}
        </Button>
      </div>
    );
  }

  // Priority 5: No changes
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
        <span>No changes</span>
      </Button>
    </div>
  );
}

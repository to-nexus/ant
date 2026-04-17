import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Undo2 } from 'lucide-react';
import { useStore } from '@/domain/store';
import { useGitChanges } from './hooks/useGitChanges';
import { useGitActions } from './hooks/useGitActions';
import { PlaceholderButton } from './components/PlaceholderButton';
import { LoadingButton } from './components/LoadingButton';
import { ActionButton } from './components/ActionButton';
import { GitChangesPanel } from './components/GitChangesPanel';
import { Button } from '../common/button';

export function GitStatusButton() {
  const { t } = useTranslation('explorer');
  const {
    selectedProject,
    selectedFeature,
    isGitStatusLoading,
    gitStatusPhase,
    gitStatusRefreshTrigger,
    fetchGitChanges,
  } = useStore();

  const { gitChanges, isGitInitialized, isFetchingChanges } = useGitChanges();
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const prevPathsRef = useRef<string>('');

  // Drive `fetchGitChanges` from the single place in the tree that mounts
  // whenever a project is selected. The slice deduplicates by key, so
  // redundant calls (SSE gitChange + refresh trigger + phase transition +
  // initial mount) collapse to at most one network request.
  //
  // We intentionally skip while `gitStatusPhase !== null` — an active git
  // operation (switch/fetch) will call `setGitStatusPhase(null)` at its
  // end, which auto-triggers a fresh fetch through the slice.
  useEffect(() => {
    if (!selectedProject) return;
    if (gitStatusPhase !== null) return;
    fetchGitChanges(selectedProject, selectedFeature || undefined);
  }, [
    selectedProject,
    selectedFeature,
    gitStatusRefreshTrigger,
    gitStatusPhase,
    fetchGitChanges,
  ]);

  // Smart sync: preserve user selections, only update when file list actually changes
  useEffect(() => {
    if (gitChanges) {
      const allPaths = [
        ...gitChanges.staged.map(f => f.path),
        ...gitChanges.unstaged.map(f => f.path),
        ...gitChanges.untracked.map(f => f.path),
      ];
      const pathsKey = allPaths.sort().join('\n');
      if (prevPathsRef.current !== pathsKey) {
        const prevPaths = new Set(prevPathsRef.current.split('\n').filter(Boolean));
        if (prevPaths.size === 0) {
          setSelectedFiles(allPaths);
        } else {
          const newPaths = allPaths.filter(p => !prevPaths.has(p));
          setSelectedFiles(prev => [
            ...prev.filter(p => allPaths.includes(p)),
            ...newPaths,
          ]);
        }
        prevPathsRef.current = pathsKey;
      }
    } else {
      setSelectedFiles([]);
      prevPathsRef.current = '';
    }
  }, [gitChanges]);
  
  const {
    isCommitting,
    isPushing,
    isPulling,
    isSyncing,
    isDiscarding,
    handleCommit,
    handlePush,
    handlePublishRepo,
    handlePull,
    handleSync,
    handleDiscard
  } = useGitActions(selectedProject, selectedFeature, gitChanges);

  if (!selectedProject) {
    return null;
  }

  if (gitStatusPhase !== null) {
    return <LoadingButton isFetchingChanges={isFetchingChanges} />;
  }

  if (isGitInitialized === false) {
    return <PlaceholderButton message={t('config:git.notInitialized')} />;
  }

  // Narrow loading gate: only show spinner when we have NO data to render
  // (initial load, post-clearGitChanges, or explicit fetch-with-null-slice).
  // When gitChanges is present we keep showing the live CTA and let the
  // refetch swap values in silently — otherwise every SSE-driven refresh
  // would flash the whole button. The stale-commit-label bug that motivated
  // widening this gate is now prevented by `clearGitChanges` which nulls
  // the slice synchronously on feature/project switch.
  if (isGitStatusLoading || (isFetchingChanges && !gitChanges)) {
    return <LoadingButton isFetchingChanges={isFetchingChanges} />;
  }

  if (!gitChanges || isGitInitialized === null) {
    return <PlaceholderButton message={t('common:status.checking')} />;
  }

  const totalChanges = gitChanges.staged.length + gitChanges.unstaged.length + gitChanges.untracked.length;

  return (
    <>
      <div className="flex-1 min-w-0 flex gap-1.5 items-center">
        <ActionButton
          gitChanges={gitChanges}
          isCommitting={isCommitting}
          isPushing={isPushing}
          isPulling={isPulling}
          isSyncing={isSyncing}
          onCommit={handleCommit}
          onPush={handlePush}
          onPublishRepo={handlePublishRepo}
          onPull={handlePull}
          onSync={handleSync}
          selectedFiles={selectedFiles}
        />
        <Button
          onClick={() => handleDiscard(selectedFiles.length < totalChanges ? selectedFiles : undefined)}
          variant="outline"
          size="sm"
          className="px-2 py-1.5 text-xs
                     bg-red-500/5 dark:bg-red-500/5
                     border-red-500/20 dark:border-red-500/20
                     hover:bg-red-500/10 dark:hover:bg-red-500/10
                     text-red-500 dark:text-red-400
                     transition-colors"
          disabled={totalChanges === 0 || isDiscarding || isGitStatusLoading}
          title={t('git.discardAll')}
        >
          <Undo2 className="w-3.5 h-3.5" />
        </Button>
      </div>
      {totalChanges > 0 && (
        <div className="w-full order-last">
          <GitChangesPanel
            gitChanges={gitChanges}
            selectedFiles={selectedFiles}
            onSelectedFilesChange={setSelectedFiles}
            onDiscardFiles={(files) => handleDiscard(files)}
            isDiscarding={isDiscarding}
          />
        </div>
      )}
    </>
  );
}

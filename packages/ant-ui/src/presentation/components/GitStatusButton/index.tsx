import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Undo2 } from 'lucide-react';
import { useGitState } from '@/application/hooks/git';
import { useGitActions as useGitStoreActions } from './hooks/useGitActions';
import { PlaceholderButton } from './components/PlaceholderButton';
import { LoadingButton } from './components/LoadingButton';
import { ActionButton } from './components/ActionButton';
import { GitChangesPanel } from './components/GitChangesPanel';
import { Button } from '../common/button';
import { useStore } from '@/domain/store';

export function GitStatusButton() {
  const { t } = useTranslation('explorer');
  const selectedProject = useStore((s) => s.selectedProject);
  const { gitStatus, gitChanges, changesFetchState, gitStatusPhase } = useGitState();

  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const prevPathsRef = useRef<string>('');

  // Smart sync: preserve user selections, only update when file list actually changes.
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
  
  const selectedFeature = useStore((s) => s.selectedFeature);
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
  } = useGitStoreActions(selectedProject, selectedFeature, gitChanges);

  if (!selectedProject) {
    return null;
  }

  // Active git operation — show phase-specific spinner.
  if (gitStatusPhase !== null) {
    return <LoadingButton />;
  }

  // Explicit uninitialized state — backend returned `isGitInitialized: false`.
  if (gitChanges && gitChanges.isGitInitialized === false) {
    return <PlaceholderButton message={t('config:git.notInitialized')} />;
  }

  // Initial load — neither endpoint has responded yet. Once we have data we
  // let silent refetches swap values without flashing the whole button.
  if (!gitStatus || !gitChanges) {
    const isFetching = changesFetchState === 'pending';
    return isFetching ? <LoadingButton /> : <PlaceholderButton message={t('common:status.checking')} />;
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
          disabled={totalChanges === 0 || isDiscarding}
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

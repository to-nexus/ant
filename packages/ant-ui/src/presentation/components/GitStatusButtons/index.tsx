import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Undo2 } from 'lucide-react';
import { useStore } from '@/domain/store';
import { useGitHubRepoConfig } from './hooks/useGitHubRepoConfig';
import { useGitChanges } from './hooks/useGitChanges';
import { useGitActions } from './hooks/useGitActions';
import { PlaceholderButton } from './components/PlaceholderButton';
import { LoadingButton } from './components/LoadingButton';
import { ActionButton } from './components/ActionButton';
import { GitChangesPanel } from './components/GitChangesPanel';
import { Button } from '../common/button';

export function GitStatusButtons() {
  const { t } = useTranslation('explorer');
  const { selectedProject, selectedFeature, isGitStatusLoading, gitStatusPhase } = useStore();
  
  const hasGitHubRepo = useGitHubRepoConfig(selectedProject);
  const { gitChanges, isGitInitialized, isFetchingChanges } = useGitChanges(selectedProject, selectedFeature, hasGitHubRepo);
  const [localGitChanges, setLocalGitChanges] = useState(gitChanges);
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  
  // Sync local state with hook state
  if (gitChanges !== localGitChanges) {
    setLocalGitChanges(gitChanges);
  }

  // Auto-select all files when changes arrive
  useEffect(() => {
    if (gitChanges) {
      const allPaths = [
        ...gitChanges.staged.map(f => f.path),
        ...gitChanges.unstaged.map(f => f.path),
        ...gitChanges.untracked.map(f => f.path),
      ];
      setSelectedFiles(allPaths);
    } else {
      setSelectedFiles([]);
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
    handlePull,
    handleSync,
    handleDiscard
  } = useGitActions(selectedProject, selectedFeature, gitChanges, setLocalGitChanges);

  if (!selectedProject) {
    return null;
  }

  if (gitStatusPhase !== null) {
    return <LoadingButton isFetchingChanges={isFetchingChanges} />;
  }

  if (hasGitHubRepo === false) {
    return <PlaceholderButton message={t('config:git.configureFirst')} />;
  }

  if (isGitInitialized === false) {
    return <PlaceholderButton message={t('config:git.notInitialized')} />;
  }

  if (isGitStatusLoading || (isFetchingChanges && !gitChanges)) {
    return <LoadingButton isFetchingChanges={isFetchingChanges} />;
  }

  if (!gitChanges || isGitInitialized === null) {
    return <PlaceholderButton message={t('common:status.checking')} />;
  }

  const totalChanges = gitChanges.staged.length + gitChanges.unstaged.length + gitChanges.untracked.length;

  return (
    <div>
      <div className="flex gap-1.5 items-center">
        <ActionButton
          gitChanges={gitChanges}
          isCommitting={isCommitting}
          isPushing={isPushing}
          isPulling={isPulling}
          isSyncing={isSyncing}
          onCommit={handleCommit}
          onPush={handlePush}
          onPull={handlePull}
          onSync={handleSync}
          selectedFiles={selectedFiles}
        />
        <Button
          onClick={() => handleDiscard()}
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
        <GitChangesPanel
          gitChanges={gitChanges}
          selectedFiles={selectedFiles}
          onSelectedFilesChange={setSelectedFiles}
          onDiscardFiles={(files) => handleDiscard(files)}
          isDiscarding={isDiscarding}
        />
      )}
    </div>
  );
}

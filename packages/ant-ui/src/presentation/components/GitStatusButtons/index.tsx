import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/domain/store';
import { useGitHubRepoConfig } from './hooks/useGitHubRepoConfig';
import { useGitChanges } from './hooks/useGitChanges';
import { useGitActions } from './hooks/useGitActions';
import { PlaceholderButton } from './components/PlaceholderButton';
import { LoadingButton } from './components/LoadingButton';
import { ActionButton } from './components/ActionButton';

export function GitStatusButtons() {
  const { t } = useTranslation('explorer');
  const { selectedProject, selectedFeature, isGitStatusLoading, gitStatusPhase } = useStore();
  
  const hasGitHubRepo = useGitHubRepoConfig(selectedProject);
  const { gitChanges, isGitInitialized, isFetchingChanges } = useGitChanges(selectedProject, selectedFeature, hasGitHubRepo);
  const [localGitChanges, setLocalGitChanges] = useState(gitChanges);
  
  // Sync local state with hook state
  if (gitChanges !== localGitChanges) {
    setLocalGitChanges(gitChanges);
  }
  
  const {
    isCommitting,
    isPushing,
    isPulling,
    isSyncing,
    handleCommit,
    handlePush,
    handlePull,
    handleSync
  } = useGitActions(selectedProject, gitChanges, setLocalGitChanges);

  // Don't show anything if no project is selected
  if (!selectedProject) {
    return null;
  }

  // ✅ STEP 1: If GitHub repo is not configured
  if (hasGitHubRepo === false) {
    return <PlaceholderButton message={t('config:git.configureFirst')} />;
  }

  // ✅ STEP 2: If Git is not initialized (repo configured, but not cloned/initialized)
  if (isGitInitialized === false) {
    return <PlaceholderButton message={t('config:git.notInitialized')} />;
  }

  // If no feature is selected
  if (!selectedFeature) {
    // Git is initialized - treat as base branch and show status below
  }

  // If Git status is loading OR actively fetching changes OR any Git operation in progress
  if (isGitStatusLoading || (isFetchingChanges && !gitChanges) || gitStatusPhase !== null) {
    return <LoadingButton isFetchingChanges={isFetchingChanges} />;
  }

  // If data is still loading
  if (!gitChanges || isGitInitialized === null) {
    return <PlaceholderButton message={t('common:status.checking')} />;
  }

  return (
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
    />
  );
}

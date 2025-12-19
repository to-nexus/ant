import { useState } from 'react';
import { useStore } from '@/domain/store';
import { useGitHubRepoConfig } from './hooks/useGitHubRepoConfig';
import { useGitChanges } from './hooks/useGitChanges';
import { useGitActions } from './hooks/useGitActions';
import { PlaceholderButton } from './components/PlaceholderButton';
import { LoadingButton } from './components/LoadingButton';
import { ActionButton } from './components/ActionButton';

export function GitStatusButtons() {
  const { selectedProject, selectedFeature, isGitStatusLoading, manualGitAction } = useStore();
  
  const hasGitHubRepo = useGitHubRepoConfig(selectedProject);
  const { gitChanges, isGitInitialized, isFetchingChanges } = useGitChanges(selectedProject, hasGitHubRepo);
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

  // If GitHub repo is not configured
  if (hasGitHubRepo === false) {
    return <PlaceholderButton message="Configure GitHub repo first" />;
  }

  // If no feature is selected
  if (!selectedFeature) {
    if (isGitInitialized === false) {
      return <PlaceholderButton message="Select a feature" />;
    }
    // Git is initialized - treat as base branch and show status below
  }

  // If Git is not initialized (and feature is selected)
  if (isGitInitialized === false && selectedFeature) {
    return <PlaceholderButton message="Git not initialized" />;
  }

  // If Git status is loading OR actively fetching changes OR manual action
  if (isGitStatusLoading || (isFetchingChanges && !gitChanges) || manualGitAction) {
    return <LoadingButton isFetchingChanges={isFetchingChanges} />;
  }

  // If data is still loading
  if (!gitChanges || isGitInitialized === null) {
    return <PlaceholderButton message="Checking..." />;
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

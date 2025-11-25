import { useState, useEffect } from 'react';
import { GitCommit, Upload, Download, RefreshCw, Check } from 'lucide-react';
import { useStore } from '@/domain/store';
import { getGitChanges, commitGitChanges, pushToGitHub, pullFromGitHub, syncWithRemote, fetchProjectConfig } from '@/infrastructure/http/api';
import { Button } from '@/presentation/components/common/button';
import { useAlertModal } from '@/application/hooks/ui/useAlertModal';

export function GitStatusButtons() {
  const { selectedProject, selectedFeature } = useStore();
  const [hasGitHubRepo, setHasGitHubRepo] = useState<boolean | null>(null); // null = checking, true = configured, false = not configured
  const [gitChanges, setGitChanges] = useState<{
    hasChanges: boolean;
    staged: string[];
    unstaged: string[];
    untracked: string[];
    ahead: number;
    behind: number;
    currentBranch?: string;
  } | null>(null);
  const [isGitInitialized, setIsGitInitialized] = useState<boolean | null>(null); // null = checking, true = initialized, false = not initialized
  const [isCommitting, setIsCommitting] = useState(false);
  const [isPushing, setIsPushing] = useState(false);
  const [isPulling, setIsPulling] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const { showError, showSuccess, AlertModal } = useAlertModal();

  // Check if GitHub repo is configured
  useEffect(() => {
    if (!selectedProject) {
      setHasGitHubRepo(null);
      setGitChanges(null);
      setIsGitInitialized(null);
      return;
    }

    const checkConfig = async () => {
      try {
        const config = await fetchProjectConfig(selectedProject);
        setHasGitHubRepo(!!config?.githubRepo);
      } catch (error) {
        console.log('[GitStatusButtons] Failed to fetch config:', error);
        setHasGitHubRepo(false);
      }
    };

    checkConfig();
  }, [selectedProject]);

  // Fetch Git changes periodically (only if GitHub repo is configured)
  useEffect(() => {
    if (!selectedProject || hasGitHubRepo === null || hasGitHubRepo === false) {
      setGitChanges(null);
      setIsGitInitialized(hasGitHubRepo === false ? false : null);
      return;
    }

    const fetchChanges = async () => {
      try {
        const changes = await getGitChanges(selectedProject);
        console.log('[GitStatusButtons] Git changes fetched:', changes);
        setGitChanges(changes);
        setIsGitInitialized(true);
      } catch (error: any) {
        console.log('[GitStatusButtons] Failed to fetch Git changes:', error.message);
        // Check if Git is not initialized
        if (error.message?.includes('not initialized')) {
          setGitChanges(null);
          setIsGitInitialized(false);
        }
      }
    };

    // ✅ When feature changes, delay initial fetch to allow branch switch to complete
    let interval: number | null = null;
    
    const delayTimer = setTimeout(() => {
      fetchChanges();
      // Then start regular polling
      interval = window.setInterval(fetchChanges, 5000);
    }, 500); // 500ms delay to ensure branch switch completes
    
    return () => {
      clearTimeout(delayTimer);
      if (interval) clearInterval(interval);
    };
  }, [selectedProject, hasGitHubRepo]); // ✅ Remove selectedFeature dependency - always show current branch

  const handleCommit = async () => {
    if (!selectedProject || !gitChanges) return;

    setIsCommitting(true);
    try {
      const result = await commitGitChanges(selectedProject);
      if (result.success) {
        showSuccess(`Committed successfully (${result.commitHash?.substring(0, 7)})`);
        // Refresh changes
        const changes = await getGitChanges(selectedProject);
        setGitChanges(changes);
      } else {
        showError(result.error || 'Failed to commit');
      }
    } catch (error: any) {
      showError(error.message || 'Failed to commit changes');
    } finally {
      setIsCommitting(false);
    }
  };

  const handlePush = async () => {
    if (!selectedProject) return;

    setIsPushing(true);
    try {
      const result = await pushToGitHub(selectedProject);
      if (result.success) {
        showSuccess('Pushed successfully');
        // Refresh changes
        const changes = await getGitChanges(selectedProject);
        setGitChanges(changes);
      } else {
        showError(result.error || 'Failed to push');
      }
    } catch (error: any) {
      showError(error.message || 'Failed to push changes');
    } finally {
      setIsPushing(false);
    }
  };

  const handlePull = async () => {
    if (!selectedProject) return;

    setIsPulling(true);
    try {
      const result = await pullFromGitHub(selectedProject);
      if (result.success) {
        showSuccess('Pulled successfully');
        // Refresh changes
        const changes = await getGitChanges(selectedProject);
        setGitChanges(changes);
      } else {
        showError(result.error || 'Failed to pull');
      }
    } catch (error: any) {
      showError(error.message || 'Failed to pull changes');
    } finally {
      setIsPulling(false);
    }
  };

  const handleSync = async () => {
    if (!selectedProject) return;

    setIsSyncing(true);
    try {
      const result = await syncWithRemote(selectedProject);
      if (result.success) {
        showSuccess('Synced successfully');
        // Refresh changes
        const changes = await getGitChanges(selectedProject);
        setGitChanges(changes);
      } else {
        showError(result.error || 'Failed to sync');
      }
    } catch (error: any) {
      showError(error.message || 'Failed to sync with remote');
    } finally {
      setIsSyncing(false);
    }
  };

  // Don't show anything if no project is selected
  if (!selectedProject) {
    return null;
  }

  // If GitHub repo is not configured, show "Configure GitHub repo first" button
  if (hasGitHubRepo === false) {
    return (
      <>
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
            Configure GitHub repo first
          </Button>
        </div>
        <AlertModal />
      </>
    );
  }

  // If no feature is selected, show "Select a feature" button
  if (!selectedFeature) {
    return (
      <>
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
            Select a feature
          </Button>
        </div>
        <AlertModal />
      </>
    );
  }

  // If Git is not initialized, show "Git not initialized" button
  if (isGitInitialized === false) {
    return (
      <>
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
            Git not initialized
          </Button>
        </div>
        <AlertModal />
      </>
    );
  }

  // If data is still loading, show "Checking..." state
  if (!gitChanges || isGitInitialized === null) {
    return (
      <>
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
            Checking...
          </Button>
        </div>
        <AlertModal />
      </>
    );
  }

  const totalChanges = gitChanges.staged.length + gitChanges.unstaged.length + gitChanges.untracked.length;

  // Determine which button to show (priority order)
  // 1. Commit (if local changes)
  // 2. Sync (if both push and pull)
  // 3. Push (if ahead only)
  // 4. Pull (if behind only)
  // 5. No changes

  const renderButton = () => {
    // Priority 1: Commit (ignore push/pull if local changes exist)
    if (totalChanges > 0) {
      return (
        <Button
          onClick={handleCommit}
          variant="outline"
          size="sm"
          className="flex-1 flex items-center justify-center gap-2 px-3 py-1.5 text-xs font-medium
                     bg-blue-500/10 dark:bg-blue-500/10 
                     border-blue-500/30 dark:border-blue-500/30
                     hover:bg-blue-500/20 dark:hover:bg-blue-500/20
                     text-blue-600 dark:text-blue-400
                     transition-colors"
          disabled={isCommitting || !selectedFeature}
          title={!selectedFeature ? 'Select a feature first' : undefined}
        >
          <GitCommit className="w-3.5 h-3.5" />
          {isCommitting ? (
            'Committing...'
          ) : (
            <span>Commit ({totalChanges}) {totalChanges === 1 ? 'file' : 'files'}</span>
          )}
        </Button>
      );
    }

    // Priority 2: Sync (both push and pull)
    if (gitChanges.ahead > 0 && gitChanges.behind > 0) {
      return (
        <Button
          onClick={handleSync}
          variant="outline"
          size="sm"
          className="flex-1 flex items-center justify-center gap-2 px-3 py-1.5 text-xs font-medium
                     bg-blue-500/10 dark:bg-blue-500/10 
                     border-blue-500/30 dark:border-blue-500/30
                     hover:bg-blue-500/20 dark:hover:bg-blue-500/20
                     text-blue-600 dark:text-blue-400
                     transition-colors"
          disabled={isSyncing || !selectedFeature}
          title={!selectedFeature ? 'Select a feature first' : 'Pull then push'}
        >
          <RefreshCw className="w-3.5 h-3.5" />
          {isSyncing ? (
            'Syncing...'
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
      );
    }

    // Priority 3: Push only
    if (gitChanges.ahead > 0) {
      return (
        <Button
          onClick={handlePush}
          variant="outline"
          size="sm"
          className="flex-1 flex items-center justify-center gap-2 px-3 py-1.5 text-xs font-medium
                     bg-blue-500/10 dark:bg-blue-500/10 
                     border-blue-500/30 dark:border-blue-500/30
                     hover:bg-blue-500/20 dark:hover:bg-blue-500/20
                     text-blue-600 dark:text-blue-400
                     transition-colors"
          disabled={isPushing || !selectedFeature}
          title={!selectedFeature ? 'Select a feature first' : undefined}
        >
          {isPushing ? (
            'Pushing...'
          ) : (
            <span className="flex items-center gap-1.5">
              Push
              <Upload className="w-3 h-3" />
              {gitChanges.ahead}
            </span>
          )}
        </Button>
      );
    }

    // Priority 4: Pull only
    if (gitChanges.behind > 0) {
      return (
        <Button
          onClick={handlePull}
          variant="outline"
          size="sm"
          className="flex-1 flex items-center justify-center gap-2 px-3 py-1.5 text-xs font-medium
                     bg-blue-500/10 dark:bg-blue-500/10 
                     border-blue-500/30 dark:border-blue-500/30
                     hover:bg-blue-500/20 dark:hover:bg-blue-500/20
                     text-blue-600 dark:text-blue-400
                     transition-colors"
          disabled={isPulling || !selectedFeature}
          title={!selectedFeature ? 'Select a feature first' : undefined}
        >
          {isPulling ? (
            'Pulling...'
          ) : (
            <span className="flex items-center gap-1.5">
              Pull
              <Download className="w-3 h-3" />
              {gitChanges.behind}
            </span>
          )}
        </Button>
      );
    }

    // Priority 5: No changes
    return (
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
    );
  };

  return (
    <>
      <div className="flex items-center flex-1">
        {renderButton()}
      </div>
      <AlertModal />
    </>
  );
}


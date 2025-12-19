import { useState, useEffect, useRef } from 'react';
import { GitCommit, Upload, Download, RefreshCw, Check } from 'lucide-react';
import { useStore } from '@/domain/store';
import { getGitChanges, commitGitChanges, pushToGitHub, pullFromGitHub, syncWithRemote, fetchProjectConfig } from '@/infrastructure/http/api';
import { Button } from '@/presentation/components/common/button';

export function GitStatusButtons() {
  const { selectedProject, selectedFeature, isGitStatusLoading, gitStatusPhase, manualGitAction, mainPanelOpenTabs } = useStore();
  const prevLoadingRef = useRef(isGitStatusLoading);  // ✅ Track previous loading state
  const prevManualActionRef = useRef(manualGitAction);  // ✅ Track previous manual action state
  const prevProjectConfigTabOpenRef = useRef(mainPanelOpenTabs.projectConfig);  // ✅ Track project config tab state
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
  const [isFetchingChanges, setIsFetchingChanges] = useState(false);  // ✅ Track if we're actively fetching git changes
  const [isCommitting, setIsCommitting] = useState(false);
  const [isPushing, setIsPushing] = useState(false);
  const [isPulling, setIsPulling] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  // Check if GitHub repo is configured
  useEffect(() => {
    if (!selectedProject) {
      setHasGitHubRepo(null);
      setGitChanges(null);
      setIsGitInitialized(null);
      prevProjectConfigTabOpenRef.current = mainPanelOpenTabs.projectConfig;
      return;
    }

    const checkConfig = async () => {
      try {
        const config = await fetchProjectConfig(selectedProject);
        const hasRepo = !!config?.githubRepo;
        console.log('[GitStatusButtons] Config checked - hasGitHubRepo:', hasRepo);
        
        const prevHasRepo = hasGitHubRepo;
        setHasGitHubRepo(hasRepo);
        
        if (!prevHasRepo && hasRepo) {
          console.log('[GitStatusButtons] 🎉 GitHub repo just configured! Fetching Git status immediately...');
          setGitChanges(null);
          setIsGitInitialized(null);
        }
      } catch (error) {
        console.log('[GitStatusButtons] Failed to fetch config:', error);
        setHasGitHubRepo(false);
      }
    };

    // ✅ Check config when:
    // 1. Project changes
    // 2. Project Config tab closes (config might have been saved)
    const projectConfigTabJustClosed = prevProjectConfigTabOpenRef.current === true && mainPanelOpenTabs.projectConfig === false;
    prevProjectConfigTabOpenRef.current = mainPanelOpenTabs.projectConfig;
    
    if (projectConfigTabJustClosed) {
      console.log('[GitStatusButtons] Project Config tab closed - rechecking config');
    }

    checkConfig();
  }, [selectedProject, mainPanelOpenTabs.projectConfig]);

  // ✅ Detect manual Git action completion and clear stale data
  useEffect(() => {
    // Detect if manual action just completed (non-null → null)
    const actionJustCompleted = prevManualActionRef.current !== null && manualGitAction === null;
    prevManualActionRef.current = manualGitAction;
    
    if (actionJustCompleted) {
      // ✅ Clear stale gitChanges immediately when manual action completes
      console.log('[GitStatusButtons] Manual Git action completed - clearing stale data');
      setGitChanges(null);
      // The next useEffect (Fetch Git changes periodically) will pick up and fetch new data
    }
  }, [manualGitAction]);

  // Fetch Git changes periodically (only if GitHub repo is configured)
  useEffect(() => {
    if (!selectedProject || hasGitHubRepo === null || hasGitHubRepo === false) {
      setGitChanges(null);
      setIsGitInitialized(hasGitHubRepo === false ? false : null);
      return;
    }

    const fetchChanges = async () => {
      setIsFetchingChanges(true);  // ✅ Mark as fetching
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
      } finally {
        setIsFetchingChanges(false);  // ✅ Mark as done
      }
    };

    // ✅ Detect if loading just started (false → true)
    const loadingJustStarted = prevLoadingRef.current === false && isGitStatusLoading === true;
    
    // ✅ Skip fetching while Git status is loading (branch switch + fetch in progress)
    if (isGitStatusLoading) {
      console.log('[GitStatusButtons] Skipping fetch - Git status loading in progress');
      
      // ✅ CRITICAL: Clear gitChanges immediately when loading starts to prevent showing stale data
      if (loadingJustStarted) {
        console.log('[GitStatusButtons] Loading started - clearing stale git changes');
        setGitChanges(null);
      }
      
      prevLoadingRef.current = isGitStatusLoading;  // Update ref
      return;
    }

    // ✅ Determine if loading just completed (true → false)
    const loadingJustCompleted = prevLoadingRef.current === true && isGitStatusLoading === false;
    prevLoadingRef.current = isGitStatusLoading;  // Update ref
    
    if (loadingJustCompleted) {
      // ✅ Loading just completed - fetch immediately (no delay) to prevent showing stale data
      console.log('[GitStatusButtons] Loading completed - fetching immediately');
      fetchChanges();
    } else if (manualGitAction !== null) {
      // ✅ Manual Git action triggered (e.g., after job completion) - fetch immediately
      console.log('[GitStatusButtons] Manual Git action triggered - fetching immediately');
      fetchChanges();
    } else {
      // ✅ Normal case - fetch once on mount (no polling)
      const delayTimer = setTimeout(() => {
        fetchChanges();
      }, 500); // 500ms delay
      
      return () => {
        clearTimeout(delayTimer);
      };
    }
    
    // ✅ No cleanup needed - no polling interval
  }, [selectedProject, hasGitHubRepo, isGitStatusLoading, manualGitAction]); // ✅ Add manualGitAction to trigger re-fetch after job completion

  const handleCommit = async () => {
    if (!selectedProject || !gitChanges) return;

    setIsCommitting(true);
    try {
      const result = await commitGitChanges(selectedProject);
      // ✅ Success/error now shown via button state, no popup
      if (result.success) {
        // Refresh changes
        const changes = await getGitChanges(selectedProject);
        setGitChanges(changes);
      } else {
        console.error('[GitStatusButtons] Commit failed:', result.error);
      }
    } catch (error: any) {
      console.error('[GitStatusButtons] Commit error:', error.message);
    } finally {
      setIsCommitting(false);
    }
  };

  const handlePush = async () => {
    if (!selectedProject) return;

    setIsPushing(true);
    try {
      const result = await pushToGitHub(selectedProject);
      // ✅ Success/error now shown via button state, no popup
      if (result.success) {
        // Refresh changes
        const changes = await getGitChanges(selectedProject);
        setGitChanges(changes);
      } else {
        console.error('[GitStatusButtons] Push failed:', result.error);
      }
    } catch (error: any) {
      console.error('[GitStatusButtons] Push error:', error.message);
    } finally {
      setIsPushing(false);
    }
  };

  const handlePull = async () => {
    if (!selectedProject) return;

    setIsPulling(true);
    try {
      const result = await pullFromGitHub(selectedProject);
      // ✅ Success/error now shown via button state, no popup
      if (result.success) {
        // Refresh changes
        const changes = await getGitChanges(selectedProject);
        setGitChanges(changes);
      } else {
        console.error('[GitStatusButtons] Pull failed:', result.error);
      }
    } catch (error: any) {
      console.error('[GitStatusButtons] Pull error:', error.message);
    } finally {
      setIsPulling(false);
    }
  };

  const handleSync = async () => {
    if (!selectedProject) return;

    setIsSyncing(true);
    try {
      const result = await syncWithRemote(selectedProject);
      // ✅ Success/error now shown via button state, no popup
      if (result.success) {
        // Refresh changes
        const changes = await getGitChanges(selectedProject);
        setGitChanges(changes);
      } else {
        console.error('[GitStatusButtons] Sync failed:', result.error);
      }
    } catch (error: any) {
      console.error('[GitStatusButtons] Sync error:', error.message);
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
    );
  }

  // ✅ If no feature is selected, behavior depends on Git connection status
  if (!selectedFeature) {
    // If Git is not initialized, show "Select a feature" (can't show base branch without Git)
    if (isGitInitialized === false) {
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
            Select a feature
          </Button>
        </div>
      );
    }
    
    // ✅ Git is initialized - treat as base branch and show status below
    // (fall through to show Git status for base branch)
  }

  // If Git is not initialized (and feature is selected), show "Git not initialized" button
  if (isGitInitialized === false && selectedFeature) {
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
          Git not initialized
        </Button>
      </div>
    );
  }

  // ✅ If Git status is loading (branch switch + fetch in progress) OR actively fetching changes OR manual action, show loading state
  if (isGitStatusLoading || (isFetchingChanges && !gitChanges) || manualGitAction) {
    // ✅ Determine message based on phase or manual action
    let loadingMessage = 'Updating...';
    
    // Priority 1: Manual Git action from dropdown (fetch, push, pull)
    if (manualGitAction === 'fetch') {
      loadingMessage = 'Fetching from remote...';
    } else if (manualGitAction === 'push') {
      loadingMessage = 'Pushing to remote...';
    } else if (manualGitAction === 'pull') {
      loadingMessage = 'Pulling from remote...';
    }
    // Priority 2: Feature switch phases
    else if (gitStatusPhase === 'switching') {
      loadingMessage = 'Updating upstream...';
    } else if (gitStatusPhase === 'fetching' || (isFetchingChanges && !isGitStatusLoading)) {
      // Show "Fetching from remote..." during FeatureSection's fetch OR during our own fetch
      loadingMessage = 'Fetching from remote...';
    }
    
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
          <RefreshCw className="w-3 h-3 animate-spin" />
          {loadingMessage}
        </Button>
      </div>
    );
  }

  // If data is still loading, show "Checking..." state
  if (!gitChanges || isGitInitialized === null) {
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
          Checking...
        </Button>
      </div>
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
    <div className="flex items-center flex-1">
      {renderButton()}
    </div>
  );
}


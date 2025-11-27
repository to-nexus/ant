import { GitBranch, AlertTriangle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useStore } from '@/domain/store';
import { createFeature, deleteFeature, startDevServer, stopDevServer, getDevServerStatus, switchToFeatureBranch, getAvailablePort, getGitChanges, fetchProjectConfig, fetchFromGitHub } from '@/infrastructure/http/api';
import { ItemDropdown } from './ItemDropdown';
import { useUIActionPolicy } from '@/application/hooks/ui/useUIActionPolicy';
import { DevServerSetup } from './DevServerSetup';
import { DevServerStatus } from './DevServerStatus';
import { useAlertModal } from '@/application/hooks/ui/useAlertModal';

export function FeatureSection() {
  const { 
    features, 
    selectedProject, 
    selectedFeature, 
    setSelectedFeature, 
    fetchFeatures,
    refreshFileTree,
    devServerStatus,
    setDevServerStatus,
    setDevServerLoading,  // ✅ 로딩 상태 설정 함수 추가
    isDevServerLoading,   // ✅ 로딩 상태 가져오기
    setGitStatusLoading,  // ✅ Git status 로딩 상태 설정
    setGitStatusPhase,    // ✅ Git status 세부 단계 설정
    setCurrentGitBranch   // ✅ Current Git branch 설정
  } = useStore();
  
  // ✅ 로딩 상태 변경 감지
  useEffect(() => {
    console.log('[FeatureSection] 📊 isDevServerLoading changed:', isDevServerLoading);
  }, [isDevServerLoading]);
  
  const [showSetupPanel, setShowSetupPanel] = useState(false);  // ✅ Setup panel (포트 입력)
  const [showStatusPanel, setShowStatusPanel] = useState(false); // ✅ Status panel (실행 결과)
  const [startError, setStartError] = useState<string | undefined>();
  const [isInitialMount, setIsInitialMount] = useState(true);
  const [isInstalling, setIsInstalling] = useState(false);  // ✅ Dependency 설치 중 상태
  const [availablePort, setAvailablePort] = useState<number>(5173);  // ✅ 사용 가능한 포트
  const [baseBranch, setBaseBranch] = useState<string>('main');  // ✅ Base branch from config
  const [gitStatus, setGitStatus] = useState<{ hasGit: boolean; hasCodebase: boolean; hasFeatures: boolean }>({ 
    hasGit: false, 
    hasCodebase: false, 
    hasFeatures: false 
  });  // ✅ Git initialization status
  const policy = useUIActionPolicy();
  const { showConfirm, AlertModal } = useAlertModal();

  // Load base branch from project config
  useEffect(() => {
    const loadBaseBranch = async () => {
      if (!selectedProject) return;
      
      try {
        const config = await fetchProjectConfig(selectedProject);
        setBaseBranch(config?.branchBase || 'main');
      } catch (error) {
        console.warn('[FeatureSection] Failed to load base branch, using default "main":', error);
        setBaseBranch('main');
      }
    };
    
    loadBaseBranch();
  }, [selectedProject]);

  // Check Git status for the selected project
  useEffect(() => {
    const checkGitStatus = async () => {
      if (!selectedProject) {
        setGitStatus({ hasGit: false, hasCodebase: false, hasFeatures: false });
        return;
      }
      
      try {
        const status = await getGitStatus(selectedProject);
        setGitStatus(status);
        console.log('[FeatureSection] Git status:', status);
      } catch (error) {
        console.error('[FeatureSection] Failed to get Git status:', error);
        setGitStatus({ hasGit: false, hasCodebase: false, hasFeatures: false });
      }
    };
    
    checkGitStatus();
  }, [selectedProject]);

  // Auto-checkout feature branch when feature is selected, or base branch when deselected
  useEffect(() => {
    const checkoutBranch = async () => {
      if (!selectedProject) return;
      
      // ✅ CRITICAL: Only proceed if Git is initialized
      if (!gitStatus.hasGit) {
        console.log('[FeatureSection] Skipping branch operations - Git not initialized');
        return;
      }
      
      // ✅ Start Git status loading
      setGitStatusLoading(true);
      
      try {
        if (selectedFeature) {
          // ✅ Phase 1: Switch to feature branch (upstream change)
          setGitStatusPhase('switching');
          console.log(`[FeatureSection] Switching to branch for feature: ${selectedFeature}`);
          const result = await switchToFeatureBranch(selectedProject, selectedFeature);
          
          if (result.success) {
            console.log(`[FeatureSection] ✅ Branch switched for ${selectedFeature}`);
            // ✅ Use actual branch name from API response
            if (result.branchName) {
              setCurrentGitBranch(result.branchName);
            }
            
            // ✅ Phase 2: Fetch from remote
            setGitStatusPhase('fetching');
            console.log(`[FeatureSection] 🔄 Auto-fetching for ${selectedFeature}...`);
            try {
              const fetchResult = await fetchFromGitHub(selectedProject);
              if (fetchResult.success) {
                console.log(`[FeatureSection] ✅ Fetch completed for ${selectedFeature}`);
              } else {
                console.warn(`[FeatureSection] Fetch failed:`, fetchResult.error);
              }
            } catch (fetchError) {
              console.warn('[FeatureSection] Fetch error (non-critical):', fetchError);
              // Fetch failure is non-critical, don't block UI
            }
          } else {
            console.error('[FeatureSection] Branch switch failed:', result.error);
            // Don't show error to user - Git might not be initialized yet
          }
        } else {
          // ✅ Phase 1: Switch to base branch
          setGitStatusPhase('switching');
          console.log(`[FeatureSection] Switching to base branch (${baseBranch}) - no feature selected`);
          const result = await switchToFeatureBranch(selectedProject, baseBranch);
          
          if (result.success) {
            console.log(`[FeatureSection] ✅ Switched to base branch (${baseBranch})`);
            // ✅ Use actual branch name from API response
            if (result.branchName) {
              setCurrentGitBranch(result.branchName);
            }
            
            // ✅ Phase 2: Fetch from remote
            setGitStatusPhase('fetching');
            console.log(`[FeatureSection] 🔄 Auto-fetching for ${baseBranch}...`);
            try {
              const fetchResult = await fetchFromGitHub(selectedProject);
              if (fetchResult.success) {
                console.log(`[FeatureSection] ✅ Fetch completed for ${baseBranch}`);
              } else {
                console.warn(`[FeatureSection] Fetch failed:`, fetchResult.error);
              }
            } catch (fetchError) {
              console.warn('[FeatureSection] Fetch error (non-critical):', fetchError);
            }
          } else {
            console.error(`[FeatureSection] Failed to switch to ${baseBranch}:`, result.error);
          }
        }
      } catch (error) {
        console.error('[FeatureSection] Branch switch error:', error);
      } finally {
        // ✅ End Git status loading
        setGitStatusPhase(null);
        setGitStatusLoading(false);
      }
    };
    
    checkoutBranch();
  }, [selectedProject, selectedFeature, baseBranch, gitStatus.hasGit, setGitStatusLoading, setGitStatusPhase, setCurrentGitBranch]); // ✅ Include gitStatus.hasGit

  // Auto-show status panel when dev server is running (including after refresh)
  useEffect(() => {
    if (devServerStatus?.running) {
      setShowStatusPanel(true);
    }
  }, [devServerStatus?.running]);

  // Initial status check on mount (페이지 새로고침 시에도 실행)
  useEffect(() => {
    if (!selectedProject || !isInitialMount) return;
    
    setIsInitialMount(false);
    
    const checkInitialStatus = async () => {
      try {
        const status = await getDevServerStatus(selectedProject);
        setDevServerStatus(status);
      } catch (error) {
        console.error('[FeatureSection] Failed to get initial status:', error);
      }
    };
    
    checkInitialStatus();
  }, [selectedProject, isInitialMount, setDevServerStatus]);

  // Poll dev server status periodically
  useEffect(() => {
    if (!selectedProject) {
      setDevServerStatus(undefined);
      return;
    }
    
    const pollStatus = async () => {
      try {
        const status = await getDevServerStatus(selectedProject);
        setDevServerStatus(status);
        
        // Check logs for various states
        if (status.logs && status.logs.length > 0) {
          // Check for installing dependencies
          const installingLog = status.logs.find(log => 
            log.message.includes('Installing dependencies')
          );
          
          if (installingLog) {
            setIsInstalling(true);
            setShowStatusPanel(true);
            return;
          }
          
          // Check for installation success
          const installSuccessLog = status.logs.find(log =>
            log.message.includes('Dependencies installed successfully')
          );
          
          if (installSuccessLog) {
            setIsInstalling(false);
          }
          
          // Check for port in use error
          const portErrorLog = status.logs.find(log => 
            log.type === 'stderr' && 
            log.message.includes('Port') && 
            log.message.includes('already in use')
          );
          
          if (portErrorLog) {
            setStartError(portErrorLog.message);
            setIsInstalling(false);
            setShowStatusPanel(true);
          }
          
          // Check for installation failure
          const installErrorLog = status.logs.find(log =>
            log.type === 'stderr' &&
            log.message.includes('Failed to install dependencies')
          );
          
          if (installErrorLog) {
            setStartError(installErrorLog.message);
            setIsInstalling(false);
            setShowStatusPanel(true);
          }
        }
      } catch (error) {
        console.error('[FeatureSection] Failed to fetch dev server status:', error);
      }
    };
    
    // Poll every 5 seconds
    const interval = setInterval(pollStatus, 5000);
    pollStatus(); // Initial poll
    
    return () => {
      clearInterval(interval);
    };
  }, [selectedProject, setDevServerStatus]);

  // ✅ Play 버튼 클릭: Setup Panel 표시 (바로 실행하지 않음)
  const handlePlayButtonClick = async () => {
    if (!selectedProject) return;
    
    // ✅ 사용 가능한 포트 가져오기
    try {
      const port = await getAvailablePort(selectedProject);
      setAvailablePort(port);
      console.log(`[FeatureSection] Available port found: ${port}`);
    } catch (error) {
      console.error('[FeatureSection] Failed to get available port, using default:', error);
      setAvailablePort(5173);
    }
    
    setShowSetupPanel(true);
    setShowStatusPanel(false);
    setStartError(undefined);
    setIsInstalling(false);
  };

  // ✅ 실제 서버 실행 (Setup Panel에서 호출)
  const handleStartDevServer = async (port: number) => {
    if (!selectedProject) return;
    
    console.log(`[FeatureSection] 🔄 Starting dev server on port ${port}, setting loading=true`);
    setDevServerLoading(true);  // ✅ 로딩 시작
    setStartError(undefined);
    setIsInstalling(false);  // ✅ 설치 상태 초기화
    
    try {
      await startDevServer(selectedProject, port);
      setShowSetupPanel(false);  // ✅ Setup panel 숨김
      setShowStatusPanel(true);  // ✅ Status panel 표시
      
      // ✅ Poll status after a short delay to allow process to initialize
      // This prevents premature "running" status before actual server start
      setTimeout(async () => {
        try {
          const status = await getDevServerStatus(selectedProject);
          setDevServerStatus(status);
          console.log('[FeatureSection] ✅ Dev server status polled:', status);
        } catch (pollError) {
          console.error('[FeatureSection] Failed to poll dev server status:', pollError);
        }
      }, 1000); // Wait 1 second for process to start and emit logs
    } catch (error: any) {
      console.error('Failed to start dev server:', error);
      setStartError(error.message || 'Unknown error');
      setShowSetupPanel(false);  // ✅ Setup panel 숨김
      setShowStatusPanel(true);  // ✅ Error status 표시
    } finally {
      console.log('[FeatureSection] ✅ Dev server start complete, setting loading=false');
      setDevServerLoading(false);  // ✅ 로딩 종료
    }
  };

  const handleStopDevServer = async () => {
    if (!selectedProject) return;
    
    setDevServerLoading(true);  // ✅ 로딩 시작
    try {
      await stopDevServer(selectedProject);
      
      // ✅ 수동 종료는 정상 종료이므로 status panel 숨기기
      setShowStatusPanel(false);
      setStartError(undefined);
      setIsInstalling(false);
      
      console.log('[FeatureSection] Dev server stopped successfully');
    } catch (error: any) {
      console.error('[FeatureSection] Failed to stop dev server:', error);
      alert(`Failed to stop dev server: ${error.message}`);
    } finally {
      setDevServerLoading(false);  // ✅ 로딩 종료
    }
  };

  const handleCreateFeature = async (featureName: string) => {
    if (!selectedProject) {
      throw new Error('No project selected');
    }
    await createFeature(selectedProject, featureName);
    await refreshFileTree();
    
    // ✅ After creating feature, directly select it (skip Git change check)
    // This is safe because:
    // 1. Backend already switched to the new feature branch
    // 2. New branch has same content as main (no changes)
    // 3. Git might be in unstable state during push
    setSelectedFeature(featureName);
  };

  const handleDeleteFeature = async (featureName: string) => {
    if (!selectedProject) {
      throw new Error('No project selected');
    }
    await deleteFeature(selectedProject, featureName);
    await refreshFileTree();
  };

  // ✅ Feature 변경 시 uncommitted changes 확인
  const handleFeatureChange = async (featureName: string | null) => {
    if (!selectedProject) return;
    
    // Same feature selected - do nothing
    if (featureName === selectedFeature) return;
    
    // Convert null to undefined for setSelectedFeature
    const targetFeature = featureName === null ? undefined : featureName;
    
    try {
      // Check for uncommitted changes in current branch
      const changes = await getGitChanges(selectedProject);
      
      if (changes.hasChanges) {
        const totalChanges = changes.staged.length + changes.unstaged.length + changes.untracked.length;
        const targetBranch = featureName ? `feature/${featureName}` : baseBranch;
        
        // Show confirmation dialog
        showConfirm(
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">
                  Uncommitted Changes Detected
                </p>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
                  You have <strong>{totalChanges} uncommitted change{totalChanges > 1 ? 's' : ''}</strong> in the current branch.
                </p>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Switching to <strong>{targetBranch}</strong> may cause file loss or conflicts.
                </p>
                <p className="text-sm text-yellow-600 dark:text-yellow-400 mt-2">
                  ⚠️ Please commit or stash your changes before switching branches.
                </p>
              </div>
            </div>
          </div>,
          {
            title: 'Warning',
            confirmText: 'Switch Anyway',
            cancelText: 'Cancel',
            onConfirm: () => {
              // User confirmed - proceed with feature change
              setSelectedFeature(targetFeature);
            },
            onCancel: () => {
              // User cancelled - do nothing
              console.log('[FeatureSection] Feature switch cancelled by user');
            }
          }
        );
      } else {
        // No changes - safe to switch
        setSelectedFeature(targetFeature);
      }
    } catch (error) {
      // If we can't check changes (e.g., Git not initialized), allow the switch
      console.warn('[FeatureSection] Could not check Git changes:', error);
      setSelectedFeature(targetFeature);
    }
  };

  const featureItems = features.map((f) => ({ name: f.name, path: f.path }));

  if (!selectedProject) {
    return null;
  }

  return (
    <div>
      <ItemDropdown
        title="Features"
        icon={GitBranch}
        items={featureItems}
        selectedItem={selectedFeature}
        onSelect={handleFeatureChange}  // ✅ Check for uncommitted changes before switching
        onCreate={handleCreateFeature}
        onDelete={handleDeleteFeature}
        onItemCreated={fetchFeatures}
        placeholder="Select a feature..."
        inputPlaceholder="Feature name..."
        onPlayClick={handlePlayButtonClick}  // ✅ Setup panel 표시
        onStopClick={handleStopDevServer}
        isPlaying={devServerStatus?.running || false}
        disabled={!policy.canChangeFeature}
        disabledReason={policy.disabledReason || undefined}
        playButtonDisabled={!policy.canStartDevServer && !policy.canStopDevServer}
        playButtonLoading={isDevServerLoading}
      />
      
      {/* Dev Server Setup Panel (포트 입력 + 실행 버튼) */}
      {showSetupPanel && selectedProject && selectedFeature && (
        <div className="mt-2">
          <DevServerSetup
            projectId={selectedProject}
            defaultPort={availablePort}
            onStart={handleStartDevServer}
            onClose={() => setShowSetupPanel(false)}
            isStarting={isDevServerLoading}
          />
        </div>
      )}
      
      {/* Dev Server Status Panel (실행 결과) */}
      {showStatusPanel && selectedProject && selectedFeature && (() => {
        // ✅ Determine status based on devServerStatus and logs
        let displayStatus: 'installing' | 'starting' | 'running' | 'error' = 'starting';
        let displayError: string | undefined = startError;
        
        if (isInstalling) {
          displayStatus = 'installing';
        } else if (isDevServerLoading) {
          displayStatus = 'starting';
        } else if (startError) {
          displayStatus = 'error';
        } else if (devServerStatus?.running) {
          displayStatus = 'running';
        } else if (devServerStatus && !devServerStatus.running) {
          // ✅ Process not running - check logs for errors
          const logs = devServerStatus.logs || [];
          const hasError = logs.some(log => 
            log.type === 'stderr' && 
            (log.message.includes('Error:') || 
             log.message.includes('error:') ||
             log.message.includes('❌'))
          );
          
          if (hasError) {
            displayStatus = 'error';
            // Extract last error message from logs
            const lastError = logs
              .filter(log => log.type === 'stderr')
              .pop();
            displayError = lastError?.message || 'Dev server failed to start';
          } else {
            // No error in logs, just not running yet
            displayStatus = 'starting';
          }
        }
        
        return (
          <div className="mt-2">
            <DevServerStatus
              status={displayStatus}
              url={devServerStatus?.url || undefined}
              errorMessage={displayError}
              onClose={() => {
                setShowStatusPanel(false);
                setStartError(undefined);
                setIsInstalling(false);
              }}
            />
          </div>
        );
      })()}
      
      {/* Alert Modal for uncommitted changes warning */}
      <AlertModal />
    </div>
  );
}


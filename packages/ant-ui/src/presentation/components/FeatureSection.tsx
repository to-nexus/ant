import { GitBranch } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useStore } from '@/domain/store';
import { createFeature, deleteFeature, startDevServer, stopDevServer, getDevServerStatus } from '@/infrastructure/http/api';
import { ItemDropdown } from './ItemDropdown';
import { useUIActionPolicy } from '@/application/hooks/ui/useUIActionPolicy';
import { DevServerSetup } from './DevServerSetup';
import { DevServerStatus } from './DevServerStatus';

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
    isDevServerLoading    // ✅ 로딩 상태 가져오기
  } = useStore();
  
  // ✅ 로딩 상태 변경 감지
  useEffect(() => {
    console.log('[FeatureSection] 📊 isDevServerLoading changed:', isDevServerLoading);
  }, [isDevServerLoading]);
  
  const [showSetupPanel, setShowSetupPanel] = useState(false);  // ✅ Setup panel (포트 입력)
  const [showStatusPanel, setShowStatusPanel] = useState(false); // ✅ Status panel (실행 결과)
  const [serverStarted, setServerStarted] = useState(false);
  const [startError, setStartError] = useState<string | undefined>();
  const [isInitialMount, setIsInitialMount] = useState(true);
  const policy = useUIActionPolicy();

  // Auto-show status panel when dev server is running (including after refresh)
  useEffect(() => {
    if (devServerStatus?.running) {
      setShowStatusPanel(true);
      setServerStarted(true);
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
  const handlePlayButtonClick = () => {
    setShowSetupPanel(true);
    setShowStatusPanel(false);
    setStartError(undefined);
  };

  // ✅ 실제 서버 실행 (Setup Panel에서 호출)
  const handleStartDevServer = async (port: number) => {
    if (!selectedProject) return;
    
    console.log(`[FeatureSection] 🔄 Starting dev server on port ${port}, setting loading=true`);
    setDevServerLoading(true);  // ✅ 로딩 시작
    setStartError(undefined);
    
    try {
      await startDevServer(selectedProject, port);
      setServerStarted(true);
      setShowSetupPanel(false);  // ✅ Setup panel 숨김
      setShowStatusPanel(true);  // ✅ Status panel 표시
      
      // SSE will handle status updates automatically
    } catch (error: any) {
      console.error('Failed to start dev server:', error);
      setStartError(error.message || 'Unknown error');
      setServerStarted(false);
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
      // Status will be updated by polling
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
  };

  const handleDeleteFeature = async (featureName: string) => {
    if (!selectedProject) {
      throw new Error('No project selected');
    }
    await deleteFeature(selectedProject, featureName);
    await refreshFileTree();
  };

  const featureItems = features.map((f) => ({ name: f.name, path: f.path }));

  if (!selectedProject) {
    return null;
  }

  // Only log when state actually changes (removed constant logging on every render)
  const hasError = showStatusPanel && !serverStarted && !devServerStatus?.running;

  return (
    <div>
      <ItemDropdown
        title="Features"
        icon={GitBranch}
        items={featureItems}
        selectedItem={selectedFeature}
        onSelect={setSelectedFeature}
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
            defaultPort={5000}  // TODO: Get from config
            onStart={handleStartDevServer}
            onClose={() => setShowSetupPanel(false)}
            isStarting={isDevServerLoading}
          />
        </div>
      )}
      
      {/* Dev Server Status Panel (실행 결과) */}
      {showStatusPanel && selectedProject && selectedFeature && (
        <div className="mt-2">
          <DevServerStatus
            status={devServerStatus?.running ? 'running' : 'error'}
            url={devServerStatus?.url}
            errorMessage={startError}
            onClose={() => {
              setShowStatusPanel(false);
              setServerStarted(false);
              setStartError(undefined);
            }}
          />
        </div>
      )}
    </div>
  );
}


import { useStore } from '@/domain/store';
import { useUIActionPolicy } from '@/application/hooks/ui/useUIActionPolicy';
import { useAlertModal } from '@/application/hooks/ui/useAlertModal';
import { useBaseBranch } from './hooks/useBaseBranch';
import { useFeatureBranchManager } from './hooks/useFeatureBranchManager';
import { useDevServerManager } from './hooks/useDevServerManager';
import { useFeatureActions } from './hooks/useFeatureActions.tsx';
import { FeatureDropdown } from './components/FeatureDropdown';
import { DevServerStatusPanel } from './components/DevServerStatusPanel';
import { getApiBase } from '@/infrastructure/http/api';

export function FeatureSection() {
  const { 
    features, 
    selectedProject, 
    selectedFeature,
    fetchFeatures
  } = useStore();
  
  const policy = useUIActionPolicy();
  const { AlertModal } = useAlertModal();
  
  // Custom hooks
  const baseBranch = useBaseBranch(selectedProject);
  const {
    state,
    status,
    ready,  // ✅ Get ready state from health check
    error,
    progress,
    startServer,
    stopServer,
    isLoading
  } = useDevServerManager(selectedProject, selectedFeature);
  
  const {
    handleCreateFeature,
    handleDeleteFeature,
    handleFeatureChange
  } = useFeatureActions(selectedProject, selectedFeature, baseBranch);
  
  // Branch manager (auto-checkout)
  useFeatureBranchManager(selectedProject, selectedFeature, baseBranch);

  if (!selectedProject) {
    return null;
  }

  return (
    <div>
      <FeatureDropdown
        features={features}
        selectedFeature={selectedFeature || undefined}
        isDevServerLoading={isLoading}
        devServerRunning={state === 'running'}
        canChangeFeature={policy.canChangeFeature}
        canStartDevServer={policy.canStartDevServer}
        canStopDevServer={policy.canStopDevServer}
        disabledReason={policy.disabledReason || undefined}
        onFeatureChange={handleFeatureChange}
        onCreate={handleCreateFeature}
        onDelete={handleDeleteFeature}
        onItemCreated={fetchFeatures}
        onPlayClick={startServer}
        onStopClick={stopServer}
      />
      
      {/* Status Panel - show for all non-idle states */}
      {(() => {
        const shouldShow = state !== 'idle' && selectedFeature;
        console.log('[FeatureSection] DevServerStatusPanel render decision:', {
          state,
          selectedFeature,
          shouldShow,
          statusUrl: status?.url
        });
        return shouldShow ? (
          <div className="mt-2">
            <DevServerStatusPanel
              state={state}
              ready={ready}  // ✅ Pass health check result
              url={status?.url}
              error={error}
              progress={progress}
              onOpen={() => {
                if (status?.url) {
                  // ✅ Remove /api suffix from getApiBase() for dev server proxy
                  // getApiBase() returns 'http://localhost:4100/api'
                  // But dev server proxy is at 'http://localhost:4100/dev/...'
                  const apiBase = getApiBase();
                  const backendBase = apiBase.replace(/\/api$/, '');  // Remove /api suffix
                  window.open(`${backendBase}${status.url}`, '_blank');
                }
              }}
            />
          </div>
        ) : null;
      })()}
      
      {/* Alert Modal for uncommitted changes warning */}
      <AlertModal />
    </div>
  );
}

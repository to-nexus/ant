import { useStore } from '@/domain/store';
import { useUIActionPolicy } from '@/application/hooks/ui/useUIActionPolicy';
import { useAlertModalContext } from '@/presentation/providers/AlertModalProvider';
import { useBaseBranch } from './hooks/useBaseBranch';
import { useFeatureBranchManager } from './hooks/useFeatureBranchManager';
import { useDevServerManager } from './hooks/useDevServerManager';
import { useFeatureActions } from './hooks/useFeatureActions.tsx';
import { FeatureDropdown } from './components/FeatureDropdown';
import { DevServerStatusPanel } from './components/DevServerStatusPanel';
import { getApiBase } from '@/infrastructure/http/api';
import { useState, useEffect } from 'react';  // ✅ Add useEffect

export function FeatureSection() {
  const { 
    features, 
    selectedProject, 
    selectedFeature,
    fetchFeatures,
  } = useStore();
  
  const policy = useUIActionPolicy();
  const { showConfirm, showWarning, showError } = useAlertModalContext();
  
  // Custom hooks
  const baseBranch = useBaseBranch(selectedProject);
  const {
    state,
    status,
    ready,  // Health check result
    setupReasoning,  // Categorized failure code
    suggestedFix,    // Suggested fix prompt
    error,
    progress,
    startServer,
    stopServer,
    isLoading,
    isDismissed,     // ✅ NEW: Dismissal state from hook
    dismissMessage   // ✅ NEW: Dismiss handler from hook
  } = useDevServerManager(selectedProject, selectedFeature);
  
  const {
    handleCreateFeature,
    handleDeleteFeature,
    handleFeatureChange
  } = useFeatureActions(selectedProject, selectedFeature, baseBranch, showConfirm, showWarning);
  
  // Branch manager (auto-checkout)
  useFeatureBranchManager(selectedProject, selectedFeature, baseBranch);
  
  // ✅ Get setPendingChatInput from Chat service
  const setPendingChatInput = useStore((state) => state.setPendingChatInput);
  
  // ✅ Track fix button click state
  const [fixButtonClicked, setFixButtonClicked] = useState(false);

  // Fix dev server setup handler (uses Chat service)
  const handleFixSetup = () => {
    if (!suggestedFix) {
      showError('수정 제안을 가져올 수 없습니다.', { title: '오류' });
      return;
    }
    
    console.log('[FeatureSection] Fix button clicked, using Chat service');
    
    // ✅ Mark fix button as clicked (removes button)
    setFixButtonClicked(true);
    
    // ✅ Use Chat service for programmatic input
    setPendingChatInput({
      message: suggestedFix,
      jobType: 'code',
      source: `dev-server-fix:${setupReasoning || (status as any)?.issues?.map((i: any) => i.reasoning).join(',') || 'unknown'}`,
    });
    
    console.log('[FeatureSection] ✅ Chat input set via Chat service');
  };
  
  // ✅ Reset fix button state when feature changes or dev server starts successfully
  useEffect(() => {
    setFixButtonClicked(false);
  }, [selectedFeature, state]);

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
        canCreateFeature={policy.canCreateFeature}
        canStartDevServer={policy.canStartDevServer}
        canStopDevServer={policy.canStopDevServer}
        disabledReason={policy.disabledReason || undefined}
        createDisabledReason={policy.createFeatureDisabledReason || undefined}
        onFeatureChange={handleFeatureChange}
        onCreate={handleCreateFeature}
        onDelete={handleDeleteFeature}
        onItemCreated={fetchFeatures}
        onPlayClick={startServer}
        onStopClick={stopServer}
      />
      
      {/* Status Panel - show for all non-idle states */}
      {(() => {
        const shouldShow = state !== 'idle' && selectedFeature && !isDismissed;  // ✅ Use hook's dismissal state
        // Debug logging (disabled for production)
        // console.log('[FeatureSection] DevServerStatusPanel render decision:', {
        //   state,
        //   selectedFeature,
        //   shouldShow,
        //   statusUrl: status?.url
        // });
        return shouldShow ? (
          <div className="mt-2">
            <DevServerStatusPanel
              state={state}
              ready={ready}  // Health check result
              setupReasoning={setupReasoning}  // Categorized failure code
              issues={status?.issues}
              url={status?.url || undefined}   // Convert null to undefined
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
              onFix={handleFixSetup}  // ✅ Pass fix handler
              onDismiss={dismissMessage}  // ✅ Use hook's dismiss handler
              fixButtonClicked={fixButtonClicked}  // ✅ Pass fix button state
            />
          </div>
        ) : null;
      })()}
      
    </div>
  );
}

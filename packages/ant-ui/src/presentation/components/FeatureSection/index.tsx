import { useStore } from '@/domain/store';
import { useUIActionPolicy } from '@/application/hooks/ui/useUIActionPolicy';
import { useAlertModalContext } from '@/presentation/providers/AlertModalProvider';
import { useBaseBranch } from './hooks/useBaseBranch';
import { useFeatureBranchManager } from './hooks/useFeatureBranchManager';
import { usePreviewManager } from './hooks/usePreviewManager';
import { useFeatureActions } from './hooks/useFeatureActions.tsx';
import { FeatureDropdown } from './components/FeatureDropdown';
import { PreviewStatusPanel } from './components/PreviewStatusPanel';
import { PREVIEW_BASE } from '@/infrastructure/http/api';
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
  } = usePreviewManager(selectedProject, selectedFeature);
  
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
      source: `preview-fix:${setupReasoning || (status as any)?.issues?.map((i: any) => i.reasoning).join(',') || 'unknown'}`,
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
        isPreviewLoading={isLoading}
        previewRunning={state === 'running'}
        canChangeFeature={policy.canChangeFeature}
        canCreateFeature={policy.canCreateFeature}
        canStartPreview={policy.canStartPreview}
        canStopPreview={policy.canStopPreview}
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
        // console.log('[FeatureSection] PreviewStatusPanel render decision:', {
        //   state,
        //   selectedFeature,
        //   shouldShow,
        //   statusUrl: status?.url
        // });
        return shouldShow ? (
          <div className="mt-2">
            <PreviewStatusPanel
              state={state}
              ready={ready}  // Health check result
              setupReasoning={setupReasoning}  // Categorized failure code
              issues={status?.issues}
              packages={status?.packages}  // ✅ NEW: Pass packages info
              url={status?.url || undefined}   // Convert null to undefined
              error={error}
              progress={progress}
              onOpen={() => {
                if (status?.url) {
                  // ✅ Preview is on a separate host (VITE_PREVIEW_HOST)
                  window.open(`${PREVIEW_BASE()}${status.url}`, '_blank');
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

import { useTranslation } from 'react-i18next';
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
import { Sparkles } from 'lucide-react';

export function FeatureSection() {
  const { 
    features, 
    selectedProject, 
    selectedFeature,
    fetchFeatures,
  } = useStore();
  
  const { t } = useTranslation(['artifacts', 'nav']);
  const policy = useUIActionPolicy();
  const runningJobsByFeature = useStore((state) => state.runningJobsByFeature);
  const { showConfirm, showError } = useAlertModalContext();
  
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
  } = usePreviewManager(selectedProject, selectedFeature, { primary: true });
  
  const {
    handleCreateFeature,
    handleDeleteFeature,
    handleFeatureChange
  } = useFeatureActions(selectedProject, selectedFeature, baseBranch, showConfirm);
  
  // Feature status manager (auto-fetch for worktree)
  useFeatureBranchManager(selectedProject, selectedFeature, baseBranch);
  
  // ✅ Get setPendingChatInput from Chat service
  const setPendingChatInput = useStore((state) => state.setPendingChatInput);
  
  // ✅ QuickStart entry for existing projects with no features
  const setQuickStartProjectId = useStore((state) => state.setQuickStartProjectId);
  
  // ✅ Defensive: auto-refresh features when the section mounts with a project
  // selected but an empty features list (e.g. after QuickStart transition or
  // any other path where the fire-and-forget fetchFeatures inside
  // setSelectedProject didn't complete in time).
  useEffect(() => {
    if (selectedProject && features.length === 0) {
      fetchFeatures(selectedProject);
    }
  // Only run on mount and when selectedProject changes — not on every features update
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProject]);

  // ✅ Track fix button click state
  const [fixButtonClicked, setFixButtonClicked] = useState(false);

  // Fix dev server setup handler (uses Chat service)
  const handleFixSetup = () => {
    if (!suggestedFix) {
      showError(t('error.fetchSuggestionsFailed'), { title: t('common:error.title') });
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
        canDelete={(name) => {
          const featureKey = `${selectedProject}/${name}`;
          if (runningJobsByFeature[featureKey]) {
            return t('nav:tabs.removeJobBlocked');
          }
          return null;
        }}
        onDelete={handleDeleteFeature}
        onPlayClick={startServer}
        onStopClick={stopServer}
        onSettingsClick={() => {
          useStore.getState().openMainPanelTab('previewConfig');
        }}
      />

      {/* QuickStart CTA — shown when project exists but has no features */}
      {features.length === 0 && selectedProject && (
        <button
          onClick={() => setQuickStartProjectId(selectedProject)}
          className="mt-2 w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-left
                     bg-gradient-to-r from-indigo-50 to-purple-50 dark:from-indigo-950/30 dark:to-purple-950/30
                     border border-indigo-200/60 dark:border-indigo-800/40
                     hover:border-indigo-300 dark:hover:border-indigo-700
                     hover:shadow-sm transition-all duration-200 group"
        >
          <Sparkles className="w-4 h-4 text-indigo-500 dark:text-indigo-400 flex-shrink-0 group-hover:scale-110 transition-transform" />
          <div className="min-w-0">
            <div className="text-sm font-medium text-indigo-700 dark:text-indigo-300">
              {t('onboarding:quickstart.goToOnboarding')}
            </div>
            <div className="text-xs text-indigo-500/70 dark:text-indigo-400/60 truncate">
              {t('onboarding:quickstart.goToOnboardingHint')}
            </div>
          </div>
        </button>
      )}
      
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

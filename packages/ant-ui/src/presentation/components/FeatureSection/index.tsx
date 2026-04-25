import { useTranslation } from 'react-i18next';
import { useStore } from '@/domain/store';
import { useUIActionPolicy } from '@/application/hooks/ui/useUIActionPolicy';
import { useAlertModalContext } from '@/presentation/providers/AlertModalProvider';
import { usePreviewManager } from './hooks/usePreviewManager';
import { useFeatureActions } from './hooks/useFeatureActions.tsx';
import { FeatureDropdown } from './components/FeatureDropdown';
import { PreviewStatusPanel } from './components/PreviewStatusPanel';
import { PREVIEW_BASE } from '@/infrastructure/http/api';
import { useState, useEffect, useCallback } from 'react';
import { QuickStartCTA } from '../common/QuickStartCTA';
import { CreationWizardModal } from '../CreationWizardModal';
import { makeFeatureKey } from '@/domain/store/slices/previewSlice';
import { selectPreviewVM } from '@/domain/store/selectors/previewSelectors';

export function FeatureSection({ explorerWidth }: { explorerWidth: number }) {
  const { 
    features, 
    selectedProject, 
    selectedFeature,
    fetchFeatures,
  } = useStore();
  
  const { t } = useTranslation(['artifacts', 'nav', 'onboarding', 'common']);
  const policy = useUIActionPolicy();
  const runningJobsByFeature = useStore((state) => state.runningJobsByFeature);
  const { showError } = useAlertModalContext();
  
  // Per-feature git refresh is owned by `useProjectLifecycle` at the app
  // root, which drives git-world reset + SSE reconnect + snapshot refill
  // on `(project, feature)` transitions. No feature-scoped manager here.

  // Read all preview render state through the single VM selector. SSE/fetch
  // writers live in `usePreviewSync` at the app root.
  const featureKey = makeFeatureKey(selectedProject, selectedFeature);
  const vm = useStore((s: any) => selectPreviewVM(s, featureKey));
  const {
    state,
    status,
    ready,
    setupReasoning,
    suggestedFix,
    error: vmError,
    progress,
    isLoading,
  } = vm;

  const {
    startServer,
    stopServer,
    isDismissed,
    dismissMessage,
    localError,
  } = usePreviewManager(selectedProject, selectedFeature);
  // Action-level error (network/timeout on POST) overrides VM error when present.
  const error = localError ?? vmError;
  
  const {
    handleCreateFeature,
    handleDeleteFeature,
    handleFeatureChange
  } = useFeatureActions(selectedProject);
  
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

  // ✅ CreationWizardModal state
  const [showWizard, setShowWizard] = useState(false);
  const [forceInlineCreate, setForceInlineCreate] = useState(false);
  const handleOpenWizard = useCallback(() => setShowWizard(true), []);
  const handleCloseWizard = useCallback(() => setShowWizard(false), []);
  const handleCreateEmpty = useCallback(() => {
    setShowWizard(false);
    setForceInlineCreate(true);
  }, []);
  const handleForceInlineCreateHandled = useCallback(() => setForceInlineCreate(false), []);

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
        previewRunning={vm.running || state === 'installing' || state === 'starting'}
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
            return t('nav:tabs.featureDeleteBlocked');
          }
          return null;
        }}
        onDelete={handleDeleteFeature}
        onPlayClick={startServer}
        onStopClick={stopServer}
        onSettingsClick={() => {
          useStore.getState().openMainPanelTab('previewConfig');
        }}
        onOpenWizard={handleOpenWizard}
        forceInlineCreate={forceInlineCreate}
        onForceInlineCreateHandled={handleForceInlineCreateHandled}
        isNarrow={explorerWidth < 260}
      />

      <CreationWizardModal
        isOpen={showWizard}
        onClose={handleCloseWizard}
        existingProjectId={selectedProject}
        onCreateEmpty={handleCreateEmpty}
      />

      {features.length === 0 && selectedProject && (
        <div className="mt-2 space-y-2">
          <QuickStartCTA
            variant="plan"
            title={t('onboarding:quickstart.fleshOutIdea')}
            hint={t('onboarding:quickstart.fleshOutIdeaHint')}
            onClick={() => setQuickStartProjectId(selectedProject)}
          />
          {/* TEMP(action-system-compat): hide design/code CTAs until ProjectWizardModal is compatible.
          <QuickStartCTA
            variant="design"
            title={t('onboarding:quickstart.designSystem')}
            hint={t('onboarding:quickstart.designSystemHint')}
            onClick={() => useStore.getState().setProjectSetupConfig({ mode: 'design', existingProjectId: selectedProject })}
          />
          <QuickStartCTA
            variant="code"
            title={t('onboarding:quickstart.codeFromDesign')}
            hint={t('onboarding:quickstart.codeFromDesignHint')}
            onClick={() => useStore.getState().setProjectSetupConfig({ mode: 'code', existingProjectId: selectedProject })}
          />
          */}
        </div>
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

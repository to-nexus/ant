import { useTranslation } from 'react-i18next';
import { useStore } from '@/domain/store';
import { useUIActionPolicy } from '@/application/hooks/ui/useUIActionPolicy';
import { useFeatureActions } from './hooks/useFeatureActions.tsx';
import { FeatureDropdown } from './components/FeatureDropdown';
import { useState, useEffect, useCallback } from 'react';
import { QuickStartCTA } from '../common/QuickStartCTA';
import { CreationWizardModal } from '../CreationWizardModal';

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

  const {
    handleCreateFeature,
    handleDeleteFeature,
    handleFeatureChange
  } = useFeatureActions(selectedProject);

  const setQuickStartProjectId = useStore((state) => state.setQuickStartProjectId);

  // Defensive: auto-refresh features when the section mounts with a project
  // selected but an empty features list (e.g. after QuickStart transition).
  useEffect(() => {
    if (selectedProject && features.length === 0) {
      fetchFeatures(selectedProject);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProject]);

  const [showWizard, setShowWizard] = useState(false);
  const [forceInlineCreate, setForceInlineCreate] = useState(false);
  const handleOpenWizard = useCallback(() => setShowWizard(true), []);
  const handleCloseWizard = useCallback(() => setShowWizard(false), []);
  const handleCreateEmpty = useCallback(() => {
    setShowWizard(false);
    setForceInlineCreate(true);
  }, []);
  const handleForceInlineCreateHandled = useCallback(() => setForceInlineCreate(false), []);

  if (!selectedProject) {
    return null;
  }

  return (
    <div>
      <FeatureDropdown
        features={features}
        selectedFeature={selectedFeature || undefined}
        canChangeFeature={policy.canChangeFeature}
        canCreateFeature={policy.canCreateFeature}
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
        </div>
      )}
    </div>
  );
}

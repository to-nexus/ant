import { useStore } from '@/domain/store';
import { useUIActionPolicy } from '@/application/hooks/ui/useUIActionPolicy';
import { useAlertModal } from '@/application/hooks/ui/useAlertModal';
import { useGitStatus } from './hooks/useGitStatus';
import { useBaseBranch } from './hooks/useBaseBranch';
import { useFeatureBranchManager } from './hooks/useFeatureBranchManager';
import { useDevServerManager } from './hooks/useDevServerManager';
import { useFeatureActions } from './hooks/useFeatureActions.tsx';
import { FeatureDropdown } from './components/FeatureDropdown';
import { DevServerPanel } from './components/DevServerPanel';

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
  const gitStatus = useGitStatus(selectedProject);
  const baseBranch = useBaseBranch(selectedProject);
  const {
    devServerStatus,
    isDevServerLoading,
    showSetupPanel,
    showStatusPanel,
    startError,
    isInstalling,
    availablePort,
    handlePlayButtonClick,
    handleStartDevServer,
    handleStopDevServer,
    setShowSetupPanel,
    setShowStatusPanel,
    setStartError,
    setIsInstalling
  } = useDevServerManager(selectedProject);
  
  const {
    handleCreateFeature,
    handleDeleteFeature,
    handleFeatureChange
  } = useFeatureActions(selectedProject, selectedFeature, baseBranch);
  
  // Branch manager (auto-checkout)
  useFeatureBranchManager(selectedProject, selectedFeature, baseBranch, gitStatus);

  if (!selectedProject) {
    return null;
  }

  return (
    <div>
      <FeatureDropdown
        features={features}
        selectedFeature={selectedFeature}
        isDevServerLoading={isDevServerLoading}
        devServerRunning={devServerStatus?.running || false}
        canChangeFeature={policy.canChangeFeature}
        canStartDevServer={policy.canStartDevServer}
        canStopDevServer={policy.canStopDevServer}
        disabledReason={policy.disabledReason}
        onFeatureChange={handleFeatureChange}
        onCreate={handleCreateFeature}
        onDelete={handleDeleteFeature}
        onItemCreated={fetchFeatures}
        onPlayClick={handlePlayButtonClick}
        onStopClick={handleStopDevServer}
      />
      
      <DevServerPanel
        selectedProject={selectedProject}
        selectedFeature={selectedFeature}
        showSetupPanel={showSetupPanel}
        showStatusPanel={showStatusPanel}
        availablePort={availablePort}
        isDevServerLoading={isDevServerLoading}
        startError={startError}
        isInstalling={isInstalling}
        devServerStatus={devServerStatus}
        onStart={handleStartDevServer}
        onCloseSetup={() => setShowSetupPanel(false)}
        onCloseStatus={() => {
          setShowStatusPanel(false);
          setStartError(undefined);
          setIsInstalling(false);
        }}
      />
      
      {/* Alert Modal for uncommitted changes warning */}
      <AlertModal />
    </div>
  );
}

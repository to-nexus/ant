import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Monitor } from 'lucide-react';
import { Spinner } from '../common/async';
import { useStore } from '@/domain/store';
import { PREVIEW_BASE } from '@/infrastructure/http/api';
import { usePreviewManager } from '../FeatureSection/hooks/usePreviewManager';
import { useDeployManager } from '../FeatureSection/hooks/useDeployManager';
import { makeFeatureKey } from '@/domain/store/slices/previewSlice';
import { selectPreviewVM } from '@/domain/store/selectors/previewSelectors';

import { usePreviewConfig } from './hooks/usePreviewConfig';
import { useConnectionEditor } from './hooks/useConnectionEditor';
import { useDismissedErrors } from './hooks/useDismissedErrors';

import { ProjectProfileSection } from './sections/ProjectProfileSection';
import { ServiceConnectionsSection } from './sections/ServiceConnectionsSection';
import { PreviewControlsSection } from './sections/PreviewControlsSection';
import { StatusConsoleSection } from './sections/StatusConsoleSection';
import { DeploySection } from './sections/DeploySection';

export function PreviewConfigEditor() {
  const { t } = useTranslation('explorer');
  const selectedProject = useStore((s) => s.selectedProject);
  const selectedFeature = useStore((s) => s.selectedFeature);
  const setPendingChatInput = useStore((s) => s.setPendingChatInput);

  const isJobRunning = useStore((s) => s.isRunning);

  // Read preview VM through the single selector; actions only come from
  // the manager facade (no SSE registration in this component).
  const featureKey = makeFeatureKey(selectedProject, selectedFeature);
  const vm = useStore((s: any) => selectPreviewVM(s, featureKey));
  const previewStatus = vm.status;
  const previewState = vm.state;
  const isPreviewLoading = vm.isLoading;

  const { startServer, stopServer } = usePreviewManager(
    selectedProject,
    selectedFeature,
  );

  const {
    status: deployStatusData,
    logs: deployLogs,
    isLoading: isDeployLoading,
    canDeploy,
    disabledReason: deployDisabledReason,
    deploy: handleDeploy,
    stop: handleStopDeploy,
    openDeployUrl,
  } = useDeployManager(selectedProject, selectedFeature, { primary: true });

  const {
    setConfig, isLoading,
    structureType, projectProfile, connections,
    phase, isReady, issues, logs, fatalIssues, warningIssues,
  } = usePreviewConfig(selectedProject, selectedFeature, previewStatus);

  const connEditor = useConnectionEditor(
    setConfig, connections, selectedProject, selectedFeature,
  );

  const { dismissedSet, dismissError, clearDismissed } = useDismissedErrors(
    selectedProject, selectedFeature,
  );

  // UI-only local state
  const [logsExpanded, setLogsExpanded] = useState(false);
  const [connectionsExpanded, setConnectionsExpanded] = useState(true);

  const isRunning = previewState === 'running';

  const handleOpenPreview = useCallback(() => {
    if (vm.url) {
      window.open(`${PREVIEW_BASE()}${vm.url}`, '_blank');
    }
  }, [vm.url]);

  const handleApplyToChat = useCallback((message: string) => {
    setPendingChatInput({ message, jobType: 'code', autoSubmit: false });
  }, [setPendingChatInput]);

  const handleStart = useCallback(async () => {
    clearDismissed();
    await startServer();
  }, [startServer, clearDismissed]);

  const handleStop = useCallback(async () => {
    await stopServer();
  }, [stopServer]);

  const handleRestart = useCallback(async () => {
    await stopServer();
    await new Promise((r) => setTimeout(r, 1000));
    await startServer();
  }, [stopServer, startServer]);

  // Early returns (after all hooks)
  if (!selectedProject) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500 dark:text-gray-400">
        {t('preview.selectWorkspace', 'Select a workspace to configure preview.')}
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Spinner size="lg" tone="muted" />
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Monitor className="w-5 h-5 text-gray-600 dark:text-gray-300" />
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {t('preview.configTitle', 'Preview Config')}
          </h2>
        </div>

        <ProjectProfileSection
          structureType={structureType}
          projectProfile={projectProfile}
        />

        <ServiceConnectionsSection
          localConns={connEditor.localConns}
          packageGroups={connEditor.packageGroups}
          isSinglePackage={connEditor.isSinglePackage}
          connectionsExpanded={connectionsExpanded}
          setConnectionsExpanded={setConnectionsExpanded}
          hasUnsavedChanges={connEditor.hasUnsavedChanges}
          editingConnId={connEditor.editingConnId}
          setEditingConnId={connEditor.setEditingConnId}
          addingNew={connEditor.addingNew}
          setAddingNew={connEditor.setAddingNew}
          isDetecting={connEditor.isDetecting}
          onAutoDetect={connEditor.handleAutoDetect}
          onSaveConnections={connEditor.handleSaveConnections}
          onUpdateConn={connEditor.handleUpdateConn}
          onDeleteConn={connEditor.handleDeleteConn}
          onAddConn={connEditor.handleAddConn}
          onApplyToChat={handleApplyToChat}
        />

        <PreviewControlsSection
          phase={phase}
          isRunning={isRunning}
          isReady={isReady}
          previewStatus={previewStatus}
          isPreviewLoading={isPreviewLoading}
          isJobRunning={isJobRunning}
          dismissedSet={dismissedSet}
          onStart={handleStart}
          onStop={handleStop}
          onRestart={handleRestart}
          onOpenPreview={handleOpenPreview}
          onDismissError={dismissError}
        />

        <StatusConsoleSection
          issues={issues}
          logs={logs}
          fatalIssues={fatalIssues}
          warningIssues={warningIssues}
          isRunning={isRunning}
          isReady={isReady}
          dismissedSet={dismissedSet}
          logsExpanded={logsExpanded}
          setLogsExpanded={setLogsExpanded}
          onDismissError={dismissError}
          onApplyToChat={handleApplyToChat}
        />

        <DeploySection
          deployStatus={deployStatusData}
          deployLogs={deployLogs}
          isDeployLoading={isDeployLoading}
          canDeploy={canDeploy}
          disabledReason={deployDisabledReason}
          onDeploy={handleDeploy}
          onStopDeploy={handleStopDeploy}
          onOpenDeployUrl={openDeployUrl}
        />
      </div>
    </div>
  );
}

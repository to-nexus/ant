import { useState, useCallback, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Spinner } from '../common/async';
import { useStore } from '@/domain/store';
import { PREVIEW_BASE } from '@/infrastructure/http/api';
import { usePreviewManager } from '../FeatureSection/hooks/usePreviewManager';
import { useDeployManager } from '../FeatureSection/hooks/useDeployManager';
import { makeFeatureKey } from '@/domain/store/slices/previewSlice';
import { selectPreviewVM } from '@/domain/store/selectors/previewSelectors';
import {
  TwoColLayout,
  TocNav,
  useActiveSection,
  DockedConsole,
} from '@/presentation/components/ConfigEditor/aurora';
import type {
  TocNavItem,
  DockedConsoleLog,
} from '@/presentation/components/ConfigEditor/aurora';

import { usePreviewConfig } from './hooks/usePreviewConfig';
import { useConnectionEditor } from './hooks/useConnectionEditor';
import { useDismissedErrors } from './hooks/useDismissedErrors';

import { ProjectProfileSection } from './sections/ProjectProfileSection';
import { ServiceConnectionsSection } from './sections/ServiceConnectionsSection';
import { PreviewControlsSection } from './sections/PreviewControlsSection';
import { StatusConsoleSection } from './sections/StatusConsoleSection';
import { DeploySection } from './sections/DeploySection';

const SECTION_IDS = [
  'c3v-live',
  'c3v-connections',
  'c3v-profile',
  'c3v-issues',
  'c3v-deploy',
];

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

  const isRunning = previewState === 'running';

  // Single scroller for TwoColLayout + DockedConsole
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [activeSection, setActiveSection] = useActiveSection(SECTION_IDS, scrollerRef);

  const dockedLogs: DockedConsoleLog[] = logs;

  const handleOpenPreview = useCallback((targetUrl?: string) => {
    // Resolution order:
    //   1. Caller-supplied url (per-package Open button in multi-frontend UI)
    //   2. vm.url (top-level representative URL — single-frontend back-compat)
    //   3. First openable frontend in vm.previewStatus.packages (fallback
    //      when top-level url is null but packages are populated)
    const resolved =
      targetUrl
      ?? vm.url
      ?? (previewStatus?.packages || []).find(
           (p) => p.type === 'frontend' && !!p.url
         )?.url
      ?? undefined;
    if (resolved) {
      window.open(`${PREVIEW_BASE()}${resolved}`, '_blank');
    }
  }, [vm.url, previewStatus?.packages]);

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

  const issuesTotal = fatalIssues.length + warningIssues.length;
  const tocItems = useMemo<TocNavItem[]>(() => [
    {
      id: 'c3v-live',
      label: t('preview.tocLive', '라이브 컨트롤'),
      icon: 'Play',
      dirty: phase === 'error',
    },
    {
      id: 'c3v-connections',
      label: t('preview.tocConnections', '서비스 연결'),
      icon: 'Package',
      count: connEditor.localConns.length || undefined,
    },
    {
      id: 'c3v-profile',
      label: t('preview.tocProfile', '프로젝트 프로파일'),
      icon: 'Layout',
    },
    {
      id: 'c3v-issues',
      label: t('preview.tocIssues', '이슈'),
      icon: 'AlertTriangle',
      count: issuesTotal || undefined,
    },
    {
      id: 'c3v-deploy',
      label: t('preview.tocDeploy', '배포'),
      icon: 'Zap',
    },
  ], [t, phase, connEditor.localConns.length, issuesTotal]);

  const handleTocSelect = useCallback((id: string) => {
    setActiveSection(id);
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [setActiveSection]);

  // Outer Aurora chrome shared by all states (loading / empty / ready)
  const outerStyle: React.CSSProperties = {
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    background: 'var(--bg-canvas)',
    minHeight: 0,
    overflow: 'hidden',
  };

  // Early returns (after all hooks)
  if (!selectedProject) {
    return (
      <div style={outerStyle}>
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--text-3)',
            fontSize: 13,
          }}
        >
          {t('preview.selectWorkspace', 'Select a workspace to configure preview.')}
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div style={outerStyle}>
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Spinner size="lg" tone="muted" />
        </div>
      </div>
    );
  }

  return (
    <div style={outerStyle}>
      <div
        ref={scrollerRef}
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <TwoColLayout
          toc={
            <TocNav
              items={tocItems}
              active={activeSection}
              onSelect={handleTocSelect}
            />
          }
          contentMaxWidth="none"
        >
          <div id="c3v-live" />
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

          <div id="c3v-connections" />
          <ServiceConnectionsSection
            localConns={connEditor.localConns}
            packageGroups={connEditor.packageGroups}
            isSinglePackage={connEditor.isSinglePackage}
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
            onToggleVirtualization={connEditor.handleToggleVirtualization}
          />

          <div id="c3v-profile" />
          <ProjectProfileSection
            structureType={structureType}
            projectProfile={projectProfile}
          />

          <div id="c3v-issues" />
          <StatusConsoleSection
            issues={issues}
            fatalIssues={fatalIssues}
            warningIssues={warningIssues}
            isRunning={isRunning}
            isReady={isReady}
            dismissedSet={dismissedSet}
            onDismissError={dismissError}
            onApplyToChat={handleApplyToChat}
          />

          <div id="c3v-deploy" />
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
        </TwoColLayout>

        <DockedConsole
          logs={dockedLogs}
          title={t('preview.consoleTitle', 'PREVIEW CONSOLE')}
          open={logsExpanded}
          onToggle={() => setLogsExpanded((v) => !v)}
          emptyHint={t('preview.consoleEmpty', '프리뷰 서버를 시작하면 로그가 표시됩니다')}
        />
      </div>
    </div>
  );
}

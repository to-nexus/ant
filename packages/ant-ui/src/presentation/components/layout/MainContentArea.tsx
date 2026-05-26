import { MainPanel } from '../MainPanel';
import { MainPanelTabsBar } from '../MainPanelTabsBar';
import { KanbanBoard } from '../kanban';
import { AgentWorkflowBoard } from '../workflow';
import { ConfigEditor } from '../ConfigEditor';
import { AccountConfigEditor } from '../AccountConfigEditor';
import { FileEditorPanel } from '../FileEditorPanel';
import { TransferTab } from '../Transfer/TransferTab';
import { PreviewConfigEditor } from '../PreviewConfigEditor';
import { ActionsPanel } from '../Actions';
import { VirtualDocumentViewer } from '../VirtualDocumentViewer';
import { useStore } from '@/domain/store';
import { isEditorTabId } from '@/domain/store/editor/editorTabMainPanel';
import { selectActiveEditorTab } from '@/domain/store/selectors/editorTabs';
import { selectIsAuthBlocked } from '@/domain/store/selectors';
import type { ProjectConfig } from '@/infrastructure/http/api';
import type { KanbanData } from '@/infrastructure/http/api';
import { OAUTH_BASE } from '@/infrastructure/http/api';
import type { WorkflowRealtimeState } from '@/domain/models/workflow';
import { useTranslation } from 'react-i18next';
import { getSignInUrl } from '@ant/auth-client';
import {
  AsyncBoundary,
  EmptyFallback,
  useAsyncResource,
} from '../common/async';

interface MainContentAreaProps {
  connectionStatus: 'connected' | 'disconnected' | 'error';
  kanbanData: KanbanData;
  workflowState: WorkflowRealtimeState | null;
}

/**
 * Host for the main panel's active tab. Resource loading (e.g. project
 * config) is driven by the store — this component no longer takes
 * `projectConfigData` / `isLoadingProjectConfig` props. The loading /
 * empty / error rendering is delegated to <AsyncBoundary>.
 */
export function MainContentArea({
  connectionStatus,
  kanbanData,
  workflowState,
}: MainContentAreaProps) {
  const { t } = useTranslation('explorer');
  const { t: tAsync } = useTranslation('async');
  const { t: tAuth } = useTranslation('auth');
  const activeTab = useStore((s) => s.mainPanelActiveTab);
  const openTabs = useStore((s) => s.mainPanelOpenTabs);
  const selectedFile = useStore((s) => s.selectedFile);
  const editorTabs = useStore((s) => s.editorTabs);
  const activeEditorTabId = useStore((s) => s.activeEditorTabId);
  const taskViewMode = useStore((s) => s.taskViewMode);
  const selectedProject = useStore((s) => s.selectedProject);
  const fetchProjectConfig = useStore((s) => s.fetchProjectConfig);
  const updateProjectConfig = useStore((s) => s.updateProjectConfig);
  const projectConfigResource = useAsyncResource<ProjectConfig>((s) => s.projectConfig);
  const isAuthBlocked = useStore(selectIsAuthBlocked);

  const handleSaveProjectConfig = async (config: ProjectConfig) => {
    if (!selectedProject) return { success: false, error: 'No project selected' };
    return updateProjectConfig(selectedProject, config);
  };
  const activeEditorTab = selectActiveEditorTab({
    mainPanelActiveTab: activeTab,
    activeEditorTabId,
    editorTabs,
  });
  const shouldRenderStreamingPreView =
    activeEditorTab?.status === 'streaming' &&
    (activeEditorTab.source === 'design' || activeEditorTab.source === 'plan');

  return (
    <MainPanel headerBar={<MainPanelTabsBar />}>
      {isAuthBlocked ? (
        <div className="flex items-center justify-center h-full">
          <div className="text-center">
            <div className="text-6xl mb-4">🔐</div>
            <h2 className="text-2xl font-semibold text-[color:var(--text-2)] mb-2">
              {t('panel.signInRequired')}
            </h2>
            <p className="text-[color:var(--text-3)] mb-4">
              {t('panel.signInHint')}
            </p>
            <a
              href={getSignInUrl({ oauthBase: OAUTH_BASE(), returnTo: '/app/' })}
              className="inline-block px-4 py-2 rounded-md text-sm font-medium"
              style={{
                background: 'var(--gradient-aurora)',
                color: 'var(--text-on-brand, #fff)',
                boxShadow: 'var(--shadow-glow-aurora)',
                transition: 'filter var(--dur-fast, 150ms) var(--ease-smooth, ease)',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.filter = 'brightness(1.08)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.filter = 'none'; }}
            >
              {tAuth('signIn.button')}
            </a>
          </div>
        </div>
      ) : connectionStatus !== 'connected' ? (
        <div className="flex items-center justify-center h-full">
          <div className="text-center">
            <div className="text-6xl mb-4">🔌</div>
            <h2 className="text-2xl font-semibold text-[color:var(--text-2)] mb-2">
              {connectionStatus === 'error' ? t('connection.failed') : t('connection.connecting')}
            </h2>
            <p className="text-[color:var(--text-3)]">
              {connectionStatus === 'error'
                ? t('connection.failedDesc')
                : t('connection.connectingDesc')}
            </p>
            {connectionStatus === 'error' && (
              <p className="text-sm text-[color:var(--text-4)] mt-4">
                {t('connection.startServerPlain')}
              </p>
            )}
          </div>
        </div>
      ) : activeTab === 'projectConfig' && openTabs.projectConfig ? (
        <div
          className="flex-1 h-full overflow-hidden"
          style={{ background: 'var(--bg-surface)' }}
        >
          <AsyncBoundary
            surface="panel"
            resource={projectConfigResource}
            retry={() => selectedProject && fetchProjectConfig(selectedProject)}
            empty={<EmptyFallback description={tAsync('empty.projectConfig')} />}
          >
            {(config) => (
              <ConfigEditor
                config={config}
                onSave={handleSaveProjectConfig}
                onClose={() => useStore.getState().closeMainPanelTab('projectConfig')}
              />
            )}
          </AsyncBoundary>
        </div>
      ) : activeTab === 'accountConfig' && openTabs.accountConfig ? (
        <div
          className="flex-1 h-full overflow-hidden"
          style={{ background: 'var(--bg-surface)' }}
        >
          <AccountConfigEditor
            onClose={() => useStore.getState().closeMainPanelTab('accountConfig')}
          />
        </div>
      ) : (activeTab === 'fileEdit' || isEditorTabId(activeTab)) && openTabs.fileEdit ? (
        // Background SSOT for the file editor slot lives HERE — on the
        // MainContentArea wrapper that owns the file-edit tab area. Inner
        // panels (FileEditorPanel / VirtualDocumentViewer) are rendered
        // mutually-exclusively into this slot and MUST NOT paint their own
        // `--bg-canvas`; they inherit it via this wrapper. Centralising the
        // background here prevents visual drift between the two viewers
        // when one is restyled in isolation. The streaming-routing condition
        // below (`shouldRenderStreamingPreView`) is the single source of
        // truth — FileEditorPanel no longer carries a parallel
        // `isStreamingPreviewTab` branch.
        <div
          className="flex-1 h-full overflow-hidden flex flex-col"
          style={{ background: 'var(--bg-canvas)' }}
        >
          <div className="flex-1 h-full overflow-hidden">
            {activeEditorTab ? (
              activeEditorTab.kind === 'virtual' || shouldRenderStreamingPreView ? (
                <VirtualDocumentViewer tab={activeEditorTab} />
              ) : activeEditorTab.path && selectedFile === activeEditorTab.path ? (
                <FileEditorPanel onClose={() => useStore.getState().closeMainPanelTab('fileEdit')} />
              ) : activeEditorTab.path ? (
                <EmptyFallback description={tAsync('empty.loadingFile', 'Loading selected file...')} />
              ) : (
                <EmptyFallback description={tAsync('empty.noFile')} />
              )
            ) : (
              <EmptyFallback description={tAsync('empty.noFile')} />
            )}
          </div>
        </div>
      ) : activeTab === 'transfer' && openTabs.transfer ? (
        <div className="flex-1 h-full overflow-hidden">
          <TransferTab />
        </div>
      ) : activeTab === 'previewConfig' && openTabs.previewConfig ? (
        <div
          className="flex-1 h-full overflow-hidden"
          style={{ background: 'var(--bg-surface)' }}
        >
          <PreviewConfigEditor />
        </div>
      ) : activeTab === 'actions' && openTabs.actions ? (
        <div
          className="flex-1 h-full overflow-hidden"
          style={{ background: 'var(--bg-surface)' }}
        >
          <ActionsPanel />
        </div>
      ) : (
        <div className="flex-1 h-full">
          {taskViewMode === 'workflow' ? (
            <AgentWorkflowBoard workflowState={workflowState} kanbanData={kanbanData} />
          ) : (
            <div className="h-full overflow-y-auto">
              <KanbanBoard kanbanData={kanbanData} workflowState={workflowState} />
            </div>
          )}
        </div>
      )}
    </MainPanel>
  );
}

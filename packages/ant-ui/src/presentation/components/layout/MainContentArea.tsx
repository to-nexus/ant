import { MainPanel } from '../MainPanel';
import { MainPanelTabsBar } from '../MainPanelTabsBar';
import { SplitLayout } from '../SplitLayout';
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
  splitLayout: 'vertical' | 'horizontal';
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
  splitLayout,
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
  const showWorkflow = useStore((s) => s.showWorkflow);
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
            <h2 className="text-2xl font-semibold text-gray-700 dark:text-gray-200 mb-2">
              {t('panel.signInRequired')}
            </h2>
            <p className="text-gray-500 dark:text-gray-400 mb-4">
              {t('panel.signInHint')}
            </p>
            <a
              href={getSignInUrl({ oauthBase: OAUTH_BASE(), returnTo: '/app/' })}
              className="inline-block px-4 py-2 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-400 transition-colors"
            >
              {tAuth('signIn.button')}
            </a>
          </div>
        </div>
      ) : connectionStatus !== 'connected' ? (
        <div className="flex items-center justify-center h-full">
          <div className="text-center">
            <div className="text-6xl mb-4">🔌</div>
            <h2 className="text-2xl font-semibold text-gray-700 dark:text-gray-200 mb-2">
              {connectionStatus === 'error' ? t('connection.failed') : t('connection.connecting')}
            </h2>
            <p className="text-gray-500 dark:text-gray-400">
              {connectionStatus === 'error'
                ? t('connection.failedDesc')
                : t('connection.connectingDesc')}
            </p>
            {connectionStatus === 'error' && (
              <p className="text-sm text-gray-400 dark:text-gray-500 mt-4">
                {t('connection.startServerPlain')}
              </p>
            )}
          </div>
        </div>
      ) : activeTab === 'projectConfig' && openTabs.projectConfig ? (
        <div className="flex-1 h-full overflow-hidden bg-white dark:bg-[#161b22]">
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
        <div className="flex-1 h-full overflow-hidden bg-white dark:bg-[#161b22]">
          <AccountConfigEditor
            onClose={() => useStore.getState().closeMainPanelTab('accountConfig')}
          />
        </div>
      ) : (activeTab === 'fileEdit' || isEditorTabId(activeTab)) && openTabs.fileEdit ? (
        <div className="flex-1 h-full overflow-hidden bg-white dark:bg-[#161b22] flex flex-col">
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
        <div className="flex-1 h-full overflow-hidden bg-white dark:bg-[#161b22]">
          <PreviewConfigEditor />
        </div>
      ) : activeTab === 'actions' && openTabs.actions ? (
        <div className="flex-1 h-full overflow-hidden bg-white dark:bg-[#161b22]">
          <ActionsPanel />
        </div>
      ) : (
        <div className="flex-1 h-full">
          {showWorkflow ? (
            <SplitLayout
              direction={splitLayout}
              first={<KanbanBoard kanbanData={kanbanData} workflowState={workflowState} />}
              second={<AgentWorkflowBoard workflowState={workflowState} />}
            />
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

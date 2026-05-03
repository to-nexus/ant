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
import type { ProjectConfig } from '@/infrastructure/http/api';
import type { KanbanData } from '@/infrastructure/http/api';
import type { WorkflowRealtimeState } from '@/domain/models/workflow';
import type { EditorTab } from '@/domain/store/types';
import { Pin, PinOff, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
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
  const activeTab = useStore((s) => s.mainPanelActiveTab);
  const openTabs = useStore((s) => s.mainPanelOpenTabs);
  const selectedFile = useStore((s) => s.selectedFile);
  const editorTabs = useStore((s) => s.editorTabs);
  const activeEditorTabId = useStore((s) => s.activeEditorTabId);
  const selectEditorTab = useStore((s) => s.selectEditorTab);
  const pinEditorTab = useStore((s) => s.pinEditorTab);
  const unpinEditorTab = useStore((s) => s.unpinEditorTab);
  const closeEditorTab = useStore((s) => s.closeEditorTab);
  const showWorkflow = useStore((s) => s.showWorkflow);
  const selectedProject = useStore((s) => s.selectedProject);
  const fetchProjectConfig = useStore((s) => s.fetchProjectConfig);
  const updateProjectConfig = useStore((s) => s.updateProjectConfig);
  const projectConfigResource = useAsyncResource<ProjectConfig>((s) => s.projectConfig);

  const handleSaveProjectConfig = async (config: ProjectConfig) => {
    if (!selectedProject) return { success: false, error: 'No project selected' };
    return updateProjectConfig(selectedProject, config);
  };
  const activeEditorTab = editorTabs.find((tab) => tab.id === activeEditorTabId) as EditorTab | undefined;

  return (
    <MainPanel headerBar={<MainPanelTabsBar />}>
      {connectionStatus !== 'connected' ? (
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
      ) : activeTab === 'fileEdit' && openTabs.fileEdit ? (
        <div className="flex-1 h-full overflow-hidden bg-white dark:bg-[#161b22] flex flex-col">
          {editorTabs.length > 0 && (
            <div className="flex items-center gap-1 px-2 py-2 border-b border-gray-200 dark:border-gray-700 overflow-x-auto">
              {editorTabs.map((tab) => {
                const isActive = tab.id === activeEditorTabId;
                return (
                  <button
                    key={tab.id}
                    className={`group inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs whitespace-nowrap border ${
                      isActive
                        ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 border-gray-300 dark:border-gray-600'
                        : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-transparent hover:bg-gray-200 dark:hover:bg-gray-700'
                    }`}
                    onClick={() => selectEditorTab(tab.id)}
                    type="button"
                    title={tab.path ?? tab.title}
                  >
                    <span className="truncate max-w-[220px]">{tab.title}</span>
                    {tab.pinned ? (
                      <Pin
                        className="w-3.5 h-3.5 opacity-70 hover:opacity-100"
                        onClick={(e) => {
                          e.stopPropagation();
                          unpinEditorTab(tab.id);
                        }}
                      />
                    ) : (
                      <PinOff
                        className="w-3.5 h-3.5 opacity-60 hover:opacity-100"
                        onClick={(e) => {
                          e.stopPropagation();
                          pinEditorTab(tab.id);
                        }}
                      />
                    )}
                    <X
                      className="w-3.5 h-3.5 opacity-60 hover:opacity-100"
                      onClick={(e) => {
                        e.stopPropagation();
                        closeEditorTab(tab.id);
                      }}
                    />
                  </button>
                );
              })}
            </div>
          )}

          <div className="flex-1 h-full overflow-hidden">
            {activeEditorTab ? (
              activeEditorTab.kind === 'virtual' ? (
                <VirtualDocumentViewer tab={activeEditorTab} />
              ) : selectedFile ? (
                <FileEditorPanel onClose={() => useStore.getState().closeMainPanelTab('fileEdit')} />
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

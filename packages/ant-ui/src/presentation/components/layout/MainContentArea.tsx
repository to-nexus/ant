import { MainPanel } from '../MainPanel';
import { MainPanelTabsBar } from '../MainPanelTabsBar';
import { SplitLayout } from '../SplitLayout';
import { KanbanBoard } from '../kanban';
import { AgentWorkflowBoard } from '../workflow';
import { ConfigEditor } from '../ConfigEditor';
import { AccountConfigEditor } from '../AccountConfigEditor';
import { FileEditorPanel } from '../FileEditorPanel';
import { TransferTab } from '../Transfer/TransferTab';
import { useStore } from '@/domain/store';
import type { ProjectConfig } from '@/infrastructure/http/api';
import type { KanbanData } from '@/infrastructure/http/api';
import type { WorkflowRealtimeState } from '@/domain/models/workflow';
import { useTranslation } from 'react-i18next';

interface MainContentAreaProps {
  projectConfigData: ProjectConfig | null;
  isLoadingProjectConfig: boolean;
  onSaveProjectConfig: (config: ProjectConfig) => Promise<{ success: boolean; error?: string }>;
  
  // Main Content
  connectionStatus: 'connected' | 'disconnected' | 'error';
  splitLayout: 'vertical' | 'horizontal';
  kanbanData: KanbanData;
  workflowState: WorkflowRealtimeState | null;
}

export function MainContentArea({
  projectConfigData,
  isLoadingProjectConfig,
  onSaveProjectConfig,
  connectionStatus,
  splitLayout,
  kanbanData,
  workflowState,
}: MainContentAreaProps) {
  const { t } = useTranslation('explorer');
  const activeTab = useStore((s) => s.mainPanelActiveTab);
  const openTabs = useStore((s) => s.mainPanelOpenTabs);
  const isJobTabCleared = useStore((s) => s.isJobTabCleared);
  const selectedFile = useStore((s) => s.selectedFile);
  
  // For "job tab cleared" we render the same empty state as when no job is selected,
  // without mutating the underlying kanban/workflow state.
  const effectiveKanbanData = isJobTabCleared
    ? { ...kanbanData, jobId: undefined, todo: [], inProgress: [], completed: [] }
    : kanbanData;
  const effectiveWorkflowState = isJobTabCleared ? null : workflowState;
  
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
          {isLoadingProjectConfig ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-gray-500 dark:text-gray-400">{t('connection.noConfig')}</div>
            </div>
          ) : projectConfigData ? (
            <ConfigEditor
              config={projectConfigData}
              onSave={onSaveProjectConfig}
              // Close is handled by tab close button (no side panel close)
              onClose={() => useStore.getState().closeMainPanelTab('projectConfig')}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-gray-500 dark:text-gray-400">
              {t('connection.noConfig')}
            </div>
          )}
        </div>
      ) : activeTab === 'accountConfig' && openTabs.accountConfig ? (
        <div className="flex-1 h-full overflow-hidden bg-white dark:bg-[#161b22]">
          <AccountConfigEditor
            onClose={() => useStore.getState().closeMainPanelTab('accountConfig')}
          />
        </div>
      ) : activeTab === 'fileEdit' && openTabs.fileEdit ? (
        <div className="flex-1 h-full overflow-hidden bg-white dark:bg-[#161b22]">
          {selectedFile ? (
            <FileEditorPanel onClose={() => useStore.getState().closeMainPanelTab('fileEdit')} />
          ) : (
            <div className="flex items-center justify-center h-full text-gray-500 dark:text-gray-400">
              {t('connection.selectFile')}
            </div>
          )}
        </div>
      ) : activeTab === 'transfer' && openTabs.transfer ? (
        <div className="flex-1 h-full overflow-hidden">
          <TransferTab />
        </div>
      ) : (
        <div className="flex-1 h-full">
          <SplitLayout
            direction={splitLayout}
            first={<KanbanBoard kanbanData={effectiveKanbanData} workflowState={effectiveWorkflowState} />}
            second={<AgentWorkflowBoard workflowState={effectiveWorkflowState} />}
          />
        </div>
      )}
    </MainPanel>
  );
}


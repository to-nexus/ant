import { MainPanel } from '../MainPanel';
import { MainPanelBar } from '../MainPanelBar';
import { SplitLayout } from '../SplitLayout';
import { KanbanBoard } from '../kanban';
import { AgentWorkflowBoard } from '../workflow';
import { ConfigEditor } from '../ConfigEditor';
import { FileEditorPanel } from '../FileEditorPanel';
import type { ProjectConfig } from '@/infrastructure/http/api';
import type { KanbanData } from '@/infrastructure/http/api';
import type { WorkflowRealtimeState } from '@/domain/models/workflow';

interface MainContentAreaProps {
  // Config Editor
  showConfigEditor: boolean;
  configData: ProjectConfig | null;
  isLoadingConfig: boolean;
  onSaveConfig: (config: ProjectConfig) => Promise<void>;
  onCloseConfig: () => void;
  
  // File Editor
  showFileEditor: boolean;
  selectedFile: string | null;
  onCloseFileEditor: () => void;
  
  // Main Content
  connectionStatus: 'connected' | 'disconnected' | 'error';
  splitLayout: 'vertical' | 'horizontal';
  kanbanData: KanbanData;
  workflowState: WorkflowRealtimeState | null;
}

export function MainContentArea({
  showConfigEditor,
  configData,
  isLoadingConfig,
  onSaveConfig,
  onCloseConfig,
  showFileEditor,
  selectedFile,
  onCloseFileEditor,
  connectionStatus,
  splitLayout,
  kanbanData,
  workflowState,
}: MainContentAreaProps) {
  return (
    <>
      {/* Config and/or File Editor Panel */}
      {(showConfigEditor || showFileEditor) && connectionStatus === 'connected' && (
        <div className="w-96 bg-white dark:bg-[#161b22] border-r border-gray-200 dark:border-[#30363d] flex flex-col overflow-hidden transition-colors shadow-sm">
          {/* Config Editor */}
          {showConfigEditor && configData && !isLoadingConfig && (
            <div className={showFileEditor ? 'h-1/2 border-b border-gray-200 dark:border-gray-700 overflow-hidden flex flex-col' : 'flex-1 overflow-hidden flex flex-col'}>
              <ConfigEditor
                config={configData}
                onSave={onSaveConfig}
                onClose={onCloseConfig}
              />
            </div>
          )}
          
          {showConfigEditor && isLoadingConfig && (
            <div className={showFileEditor ? 'h-1/2 border-b border-gray-200 dark:border-gray-700 flex items-center justify-center' : 'flex-1 flex items-center justify-center'}>
              <div className="text-gray-500 dark:text-gray-400">Loading configuration...</div>
            </div>
          )}

          {/* File Editor */}
          {showFileEditor && selectedFile && (
            <div className={showConfigEditor ? 'h-1/2 overflow-hidden' : 'flex-1 overflow-hidden'}>
              <FileEditorPanel onClose={onCloseFileEditor} />
            </div>
          )}
        </div>
      )}

      {/* MainPanel: Central viewport */}
      <MainPanel
        headerBar={<MainPanelBar />}
      >
        {connectionStatus === 'connected' ? (
          <SplitLayout
            direction={splitLayout}
            first={<KanbanBoard kanbanData={kanbanData} workflowState={workflowState} />}
            second={<AgentWorkflowBoard workflowState={workflowState} />}
          />
        ) : (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <div className="text-6xl mb-4">🔌</div>
              <h2 className="text-2xl font-semibold text-gray-700 dark:text-gray-200 mb-2">
                {connectionStatus === 'error' ? 'Connection Failed' : 'Connecting...'}
              </h2>
              <p className="text-gray-500 dark:text-gray-400">
                {connectionStatus === 'error' 
                  ? 'Unable to connect to ANT server. Please make sure the server is running.' 
                  : 'Connecting to ANT server...'}
              </p>
              {connectionStatus === 'error' && (
                <p className="text-sm text-gray-400 dark:text-gray-500 mt-4">
                  Run <code className="bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 px-2 py-1 rounded">pnpm dev:cli</code> to start the server
                </p>
              )}
            </div>
          </div>
        )}
      </MainPanel>
    </>
  );
}


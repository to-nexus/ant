import { useEffect, useRef, useState } from 'react';
import { GlobalNavBar } from '@/presentation/components/GlobalNavBar';
// Chat data는 ChatPanel에서만 사용 (App에서는 불필요)
import { fetchFeatureSession } from '@/infrastructure/http/api';
import { useStore } from '@/domain/store';
import { useKanban } from '@/application/hooks/features/useKanban';
import { useWorkflow } from '@/application/hooks/features/useWorkflow';
import { useLayoutState } from '@/application/hooks/ui/useLayoutState';
import { useResizeHandlers } from '@/application/hooks/ui/useResizeHandlers';
import { useHealthCheck } from '@/application/hooks/ui/useHealthCheck';
import { useSessionLoader } from '@/application/hooks/ui/useSessionLoader';
import { useJobRestoration } from '@/application/hooks/ui/useJobRestoration';
import { useConfigLoader } from '@/application/hooks/ui/useConfigLoader';
import { ExplorerPanel } from '@/presentation/components/layout/ExplorerPanel';
import { MainContentArea } from '@/presentation/components/layout/MainContentArea';
import { ChatSidebarWrapper } from '@/presentation/components/layout/ChatSidebarWrapper';
import { LocalSetupGuide } from '@/presentation/pages/LocalSetupGuide';
import { ChevronRight } from 'lucide-react';

function App() {
  // ✅ Route handling: Track current path
  const [currentPath, setCurrentPath] = useState(window.location.pathname);
  
  useEffect(() => {
    const handlePopState = () => {
      setCurrentPath(window.location.pathname);
    };
    
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);
  
  // ✅ Development: Render tracking for debugging
  const renderCountRef = useRef(0);
  const prevPropsRef = useRef<Record<string, any>>({});
  renderCountRef.current += 1;
  
  // ✅ Layout state management (extracted to hook)
  const layout = useLayoutState();
  const {
    explorerWidth,
    isExplorerCollapsed,
    isResizingExplorer,
    chatWidth,
    isChatCollapsed,
    isResizingChat,
    setExplorerWidth,
    setIsExplorerCollapsed,
    setIsResizingExplorer,
    setIsChatCollapsed,
    setIsResizingChat,
  } = layout;
  
  // ✅ Resize handlers (extracted to hook)
  useResizeHandlers(layout);
  
  // ✅ Store subscriptions (only what's actually used)
  const selectedProject = useStore((state) => state.selectedProject);
  const selectedFeature = useStore((state) => state.selectedFeature);
  const selectedFile = useStore((state) => state.selectedFile);
  const selectedAgent = useStore((state) => state.selectedAgent);
  const isRunning = useStore((state) => state.isRunning);
  const connectionStatus = useStore((state) => state.connectionStatus);
  const setSession = useStore((state) => state.setSession);
  const splitLayout = useStore((state) => state.splitLayout);
  const mainView = useStore((state) => state.mainView);
  const ideWorkspacePath = useStore((state) => state.ideWorkspacePath);
  const setIdeWorkspacePath = useStore((state) => state.setIdeWorkspacePath);
  const ideReloadTimestamp = useStore((state) => state.ideReloadTimestamp);
  
  // ✅ Domain data (via Application Hooks)
  const { kanbanData } = useKanban();
  const { workflowData } = useWorkflow();
  
  // ✅ Load IDE workspace path when switching to Code IDE view
  // Only run when mainView changes to 'codeIde', not when ideWorkspacePath changes
  useEffect(() => {
    if (mainView === 'codeIde' && !ideWorkspacePath && selectedProject) {
      // Lazy load workspace path when editor is opened
      (async () => {
        try {
          const { fetchProjectConfig } = await import('@/infrastructure/http/api');
          const { getCodebasePath } = await import('@/shared/utils/workspace-path');
          
          const config = await fetchProjectConfig(selectedProject);
          if (!config) {
            console.error('[App] Failed to load project config');
            return;
          }
          
          let workspacePath: string;
          
          if (config.repoType === 'cloud') {
            // Docker mount: $HOME:/workspace → /Users/probe → /workspace
            // Backend workspace: /Users/probe/ant-workspaces/...
            // IDE workspace: /workspace/ant-workspaces/...
            const codebasePath = getCodebasePath(selectedProject, config);
            workspacePath = `/workspace/${codebasePath}`;
          } else {
            if (!config.localPath) return;
            workspacePath = config.localPath.startsWith('~/')
              ? config.localPath.replace('~', '/workspace')
              : config.localPath.startsWith('~')
              ? config.localPath.replace('~', '/workspace')
              : `/workspace${config.localPath}`;
          }
          
          setIdeWorkspacePath(workspacePath);
        } catch (error) {
          console.error('[App] Failed to load IDE workspace path:', error);
        }
      })();
    }
  // ✅ Remove ideWorkspacePath from dependencies to prevent double render
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mainView, selectedProject]);
  
  // ✅ Chat SSE는 Store에서 자동 관리 (ChatPanel에서만 사용)
  // App.tsx에서는 불필요하므로 제거 → 불필요한 리렌더링 방지

  // ✅ Health check (extracted to hook)
  useHealthCheck();
  
  // ✅ Load system configuration on mount
  const loadSystemConfig = useStore((state) => state.loadSystemConfig);
  useEffect(() => {
    loadSystemConfig();
  }, [loadSystemConfig]);

  // ✅ Session restoration (extracted to hook)
  useSessionLoader(connectionStatus);

  // ✅ Job restoration (extracted to hook)
  useJobRestoration({ 
    connectionStatus,
    selectedProject: selectedProject || null,
    selectedFeature: selectedFeature || null
  });

  // ✅ Config loading (extracted to hook)
  const { projectConfigData, isLoadingProjectConfig, handleSaveProjectConfig } = useConfigLoader(
    useStore((state) => state.mainPanelOpenTabs.projectConfig),
    selectedProject || null,
    // ✅ Callback: Trigger Git status refresh in ProjectSection
    () => {
      // Force Git status refresh by incrementing trigger
      const currentTrigger = useStore.getState().gitStatusRefreshTrigger || 0;
      useStore.setState({ gitStatusRefreshTrigger: currentTrigger + 1 });
    }
  );

  // ✅ Development: Render tracking for debugging
  if (import.meta.env.DEV && renderCountRef.current > 1) {
    const currentProps = {
      selectedProject,
      selectedFeature,
      selectedFile,
      selectedAgent,
      isRunning,
      kanbanDataSource: kanbanData?.dataSource,
      workflowNode: workflowData?.currentNode,
      projectConfigData: !!projectConfigData,
      isLoadingProjectConfig,
      isExplorerCollapsed,
      explorerWidth,
      isResizingExplorer,
      isChatCollapsed,
      chatWidth,
      isResizingChat,
    };
    
    const changes: string[] = [];
    Object.keys(currentProps).forEach(key => {
      if (prevPropsRef.current[key] !== currentProps[key as keyof typeof currentProps]) {
        changes.push(`${key}: ${prevPropsRef.current[key]} → ${currentProps[key as keyof typeof currentProps]}`);
      }
    });
    
    // if (changes.length > 0) {
    //   console.log(`[App] 🔄 Render #${renderCountRef.current} - Changes:`, changes);
    // }
    
    prevPropsRef.current = currentProps;
  }

  // Load session when project/feature changes (but not during task execution)
  useEffect(() => {
    async function loadSession() {
      if (!selectedProject || !selectedFeature) {
        setSession(undefined);
        return;
      }

      // Don't reload session while task is running (use live data instead)
      if (isRunning) {
        console.log('[App] Skipping session load (task is running, using live data)');
        return;
      }

      try {
        const session = await fetchFeatureSession(selectedProject, selectedFeature);
        setSession(session ?? undefined);
      } catch (error) {
        console.error('[App] Failed to load session:', error);
        setSession(undefined);
      }
    }

    loadSession();
  }, [selectedProject, selectedFeature, isRunning, setSession]);

  // ✅ File editor is now a MainPanel tab (FileEdit). No side panel toggling here.

  // ✅ Show local setup guide for /local path
  if (currentPath === '/local') {
    return (
      <>
        <GlobalNavBar />
        <LocalSetupGuide />
      </>
    );
  }

  return (
    <div className="h-screen bg-[#f6f8fa] dark:bg-[#0d1117] flex flex-col transition-colors">
      {/* ✅ GNB uses hooks directly - no props needed */}
      <GlobalNavBar />
      
      {/* Main Layout */}
      {mainView === 'codeIde' ? (
        // ✅ Editor View: OpenVSCode Server iframe
        // ✅ CRITICAL: Use ideReloadTimestamp in key and src to force reload
        // Docker container is shared, timestamp forces VS Code to reload workspace
        <div className="flex-1 pt-16">
          <iframe
            key={`ide-${selectedFeature || 'base'}-${ideReloadTimestamp}`}
            src={`http://localhost:4400/?folder=${encodeURIComponent(ideWorkspacePath || '/workspace')}&tk=${ideReloadTimestamp}`}
            className="w-full h-full border-0"
            title="ANT Code Editor"
          />
        </div>
      ) : (
        // ✅ Agents View: Original UI
      <div className="flex-1 flex gap-0 overflow-hidden pt-16">
        {/* Explorer Panel */}
        <ExplorerPanel
          isCollapsed={isExplorerCollapsed}
          width={explorerWidth}
          connectionStatus={connectionStatus}
          onCollapse={() => setIsExplorerCollapsed(true)}
          onResizeStart={() => setIsResizingExplorer(true)}
        />
        
        {/* Collapsed Explorer Button */}
        {isExplorerCollapsed && (
          <div className="w-10 bg-white dark:bg-[#161b22] border-r border-gray-200 dark:border-[#30363d] flex flex-col items-center shrink-0 transition-colors shadow-sm">
            <button
              onClick={() => {
                setIsExplorerCollapsed(false);
                setExplorerWidth(320);
              }}
              className="h-10 w-10 flex items-center justify-center border-b border-gray-200 dark:border-[#30363d] bg-gray-50 dark:bg-[#0d1117] text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
              title="Expand Explorer"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Main Content Area */}
        <MainContentArea
          projectConfigData={projectConfigData}
          isLoadingProjectConfig={isLoadingProjectConfig}
          onSaveProjectConfig={handleSaveProjectConfig}
          connectionStatus={connectionStatus}
          splitLayout={splitLayout}
          kanbanData={kanbanData}
          workflowState={workflowData}
        />

        {/* Chat Panel */}
        <ChatSidebarWrapper
          isCollapsed={isChatCollapsed}
          width={chatWidth}
          isResizing={isResizingChat}
          selectedAgent={selectedAgent || ''}
          selectedProject={selectedProject || null}
          selectedFeature={selectedFeature || null}
          onExpand={() => setIsChatCollapsed(false)}
          onCollapse={() => setIsChatCollapsed(true)}
          onResizeStart={() => setIsResizingChat(true)}
        />
      </div>
      )}
    </div>
  );
}

export default App;


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
  const frontendMode = useStore((state) => state.frontendMode);
  const backendMode = useStore((state) => state.backendMode);
  
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
  const prevSelectedFileRef = useRef<string | undefined>(undefined);
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
  const showConfigEditor = useStore((state) => state.showConfigEditor);
  const showFileEditor = useStore((state) => state.showFileEditor);
  const setShowConfigEditor = useStore((state) => state.setShowConfigEditor);
  const setShowFileEditor = useStore((state) => state.setShowFileEditor);
  const selectFile = useStore((state) => state.selectFile);
  const setSession = useStore((state) => state.setSession);
  const splitLayout = useStore((state) => state.splitLayout);
  const viewMode = useStore((state) => state.viewMode);
  const ideWorkspacePath = useStore((state) => state.ideWorkspacePath);
  const setIdeWorkspacePath = useStore((state) => state.setIdeWorkspacePath);
  
  // ✅ Domain data (via Application Hooks)
  const { kanbanData } = useKanban();
  const { workflowData } = useWorkflow();
  
  // ✅ Load IDE workspace path when switching to editor view
  // Only run when viewMode changes to 'editor', not when ideWorkspacePath changes
  useEffect(() => {
    if (viewMode === 'editor' && !ideWorkspacePath && selectedProject) {
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
            const codebasePath = getCodebasePath(selectedProject, config);
            workspacePath = `/workspace/dev/ant/${codebasePath}`;
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
  }, [viewMode, selectedProject]);
  
  // ✅ Chat SSE는 Store에서 자동 관리 (ChatPanel에서만 사용)
  // App.tsx에서는 불필요하므로 제거 → 불필요한 리렌더링 방지

  // ✅ Health check (extracted to hook)
  useHealthCheck();

  // ✅ Session restoration (extracted to hook)
  useSessionLoader(connectionStatus);

  // ✅ Job restoration (extracted to hook)
  useJobRestoration({ 
    connectionStatus,
    selectedProject: selectedProject || null,
    selectedFeature: selectedFeature || null
  });

  // ✅ Config loading (extracted to hook)
  const { configData, isLoadingConfig, handleSaveConfig } = useConfigLoader(
    showConfigEditor,
    selectedProject || null
  );
  
  // ✅ Auto-redirect: Cloud frontend with local mode → /local page
  useEffect(() => {
    if (frontendMode === 'cloud' && backendMode === 'local' && currentPath !== '/local') {
      console.log('[App] Auto-redirecting to /local (Cloud frontend + Local backend selected)');
      window.history.pushState({}, '', '/local');
      setCurrentPath('/local');
    }
  }, [frontendMode, backendMode, currentPath]);

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
      configData: !!configData,
      isLoadingConfig,
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
    
    if (changes.length > 0) {
      console.log(`[App] 🔄 Render #${renderCountRef.current} - Changes:`, changes);
    }
    
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

  // Auto-open/close file editor when file is selected/deselected
  useEffect(() => {
    const prevFile = prevSelectedFileRef.current;
    const fileChanged = prevFile !== selectedFile;
    
    if (selectedFile && fileChanged) {
      // 새 파일이 선택되면 에디터 자동 열기 (토글로 닫은 경우는 존중)
      setShowFileEditor(true);
    } else if (!selectedFile && showFileEditor) {
      // 파일이 선택 해제되면 에디터 자동 닫기
      setShowFileEditor(false);
    }
    
    // 현재 파일을 다음 비교를 위해 저장
    prevSelectedFileRef.current = selectedFile;
  }, [selectedFile, showFileEditor, setShowFileEditor]);

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
      {viewMode === 'editor' ? (
        // ✅ Editor View: OpenVSCode Server iframe
        <div className="flex-1 pt-16">
          <iframe
            key={`ide-${ideWorkspacePath || 'default'}`}
            src={`http://localhost:4400/?folder=${encodeURIComponent(ideWorkspacePath || '/workspace')}`}
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
          selectedFile={selectedFile || null}
          showFileEditor={showFileEditor}
          connectionStatus={connectionStatus}
          onCollapse={() => setIsExplorerCollapsed(true)}
          onToggleFileEditor={() => setShowFileEditor(!showFileEditor)}
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
          showConfigEditor={showConfigEditor}
          configData={configData}
          isLoadingConfig={isLoadingConfig}
          onSaveConfig={handleSaveConfig}
          onCloseConfig={() => setShowConfigEditor(false)}
          showFileEditor={showFileEditor}
          selectedFile={selectedFile || null}
          onCloseFileEditor={() => {
            // 에디터 닫기 버튼: 에디터 닫고 + 파일 선택 해제
            selectFile(undefined);
          }}
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


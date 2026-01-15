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
import { AlertModalProvider } from '@/presentation/providers/AlertModalProvider';

function App() {
  // ✅ Route handling: Track current path
  const [currentPath, setCurrentPath] = useState(window.location.pathname);
  
  // ✅ Handle Google OAuth callback
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const authStatus = urlParams.get('auth');
    const userDataParam = urlParams.get('user');
    const errorParam = urlParams.get('error');
    
    if (authStatus === 'success' && userDataParam) {
      try {
        const userData = JSON.parse(decodeURIComponent(userDataParam));
        const setUser = useStore.getState().setUser;
        
        // Store user in global state
        setUser(userData.email, userData.organization);
        
        // Load projects after authentication
        const fetchProjects = useStore.getState().fetchProjects;
        fetchProjects();
        
        // Show success notification
        console.log('[Auth] Successfully signed in with Google:', userData.email);
        
        // Clean up URL
        window.history.replaceState({}, '', '/');
      } catch (error) {
        console.error('[Auth] Failed to parse OAuth callback data:', error);
      }
    } else if (errorParam) {
      console.error('[Auth] OAuth error:', errorParam);
      // TODO: Show error notification to user
    }
  }, []);
  
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
  const ideBaseUrl = useStore((state) => state.ideBaseUrl);
  const ideWorkspacePath = useStore((state) => state.ideWorkspacePath);
  const setIdeWorkspacePath = useStore((state) => state.setIdeWorkspacePath);
  const ideReloadTimestamp = useStore((state) => state.ideReloadTimestamp);
  const ideConnecting = useStore((state) => state.ideConnecting);
  const ideConnectError = useStore((state) => state.ideConnectError);
  const ideFrameLoaded = useStore((state) => state.ideFrameLoaded);

  // ✅ Auto-retry IDE iframe load ONLY if iframe didn't finish loading
  const ideRetryCountRef = useRef(0);
  const lastIdeBaseUrlRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (mainView !== 'codeIde') return;
    if (!ideBaseUrl || ideConnecting) return;

    if (lastIdeBaseUrlRef.current !== ideBaseUrl) {
      lastIdeBaseUrlRef.current = ideBaseUrl;
      ideRetryCountRef.current = 0;
    }

    // Stop retries once iframe successfully loaded
    if (ideFrameLoaded) return;

    // Do at most 2 automatic reloads while still not loaded
    if (ideRetryCountRef.current >= 2) return;

    const t = setTimeout(() => {
      // Only retry if still not loaded at the time the timer fires
      if (!useStore.getState().ideFrameLoaded) {
        ideRetryCountRef.current += 1;
        useStore.getState().reloadIdeFrame();
      }
    }, ideRetryCountRef.current === 0 ? 1200 : 3500);

    return () => clearTimeout(t);
  }, [mainView, ideBaseUrl, ideConnecting, ideFrameLoaded]);

  // ✅ Refresh-safe: if we reload while in codeIde view, re-connect to IDE automatically.
  useEffect(() => {
    if (mainView !== 'codeIde') return;
    if (!selectedProject) return;
    if (ideBaseUrl) return;
    if (ideConnecting) return;

    (async () => {
      try {
        useStore.getState().setIdeConnecting(true);
        useStore.getState().setIdeFrameLoaded(false);
        useStore.getState().setIdeWorkspacePath(`/${selectedProject}`);

        const { startCloudIDE, SERVER_BASE } = await import('@/infrastructure/http/api');
        const featureName = selectedFeature || 'main';
        const { instance } = await startCloudIDE(selectedProject, featureName);

        // ✅ Use proxy URL instead of directUrl for production
        const proxyUrl = `${SERVER_BASE()}${instance.url}`;
        useStore.getState().setIdeBaseUrl(proxyUrl);
        useStore.getState().setIdeWorkspacePath(instance.workspacePath || `/${selectedProject}`);
        useStore.getState().reloadIdeFrame();
      } catch (e: any) {
        useStore.getState().setIdeConnecting(false, e?.message || 'Failed to reconnect IDE');
        return;
      }
      useStore.getState().setIdeConnecting(false);
    })();
  }, [mainView, selectedProject, selectedFeature, ideBaseUrl, ideConnecting]);
  
  // ✅ Domain data (via Application Hooks)
  const { kanbanData } = useKanban();
  const { workflowData } = useWorkflow();
  
  // ✅ Load IDE workspace path when switching to Code IDE view
  // Only run when mainView changes to 'codeIde', not when ideWorkspacePath changes
  useEffect(() => {
    if (mainView === 'codeIde' && !ideWorkspacePath && selectedProject) {
      // ✅ Cloud IDE containers mount the project at /{projectId} (project-mode fixed).
      // Avoid legacy /workspace/... mapping which causes "Workspace does not exist" after refresh.
      setIdeWorkspacePath(`/${selectedProject}`);
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
      <AlertModalProvider>
        <>
          <GlobalNavBar />
          <LocalSetupGuide />
        </>
      </AlertModalProvider>
    );
  }

  return (
    <AlertModalProvider>
      <div className="h-screen bg-[#f6f8fa] dark:bg-[#0d1117] flex flex-col transition-colors">
        {/* ✅ GNB uses hooks directly - no props needed */}
        <GlobalNavBar />
        
        {/* Main Layout */}
        {mainView === 'codeIde' ? (
          // ✅ Editor View: OpenVSCode Server iframe
          // ✅ CRITICAL: Use ideReloadTimestamp in key and src to force reload
          // Docker container is shared, timestamp forces VS Code to reload workspace
          <div className="flex-1 pt-16">
            {ideConnecting || !ideBaseUrl ? (
              <div className="w-full h-full flex items-center justify-center">
                <div className="max-w-lg w-full px-6">
                  <div className="rounded-xl border border-gray-200 dark:border-[#30363d] bg-white dark:bg-[#161b22] p-6 shadow-sm">
                    <div className="h-4 w-44 bg-gray-200 dark:bg-gray-700 rounded animate-pulse mb-4" />
                    <div className="h-3 w-full bg-gray-200 dark:bg-gray-700 rounded animate-pulse mb-2" />
                    <div className="h-3 w-5/6 bg-gray-200 dark:bg-gray-700 rounded animate-pulse mb-6" />
                    <div className="text-sm text-gray-600 dark:text-gray-300">
                      {ideConnectError ? `IDE 로딩 실패: ${ideConnectError}` : 'IDE 컨테이너를 시작하는 중입니다...'}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <iframe
                key={`ide-${selectedFeature || 'base'}-${ideReloadTimestamp}`}
                src={`${ideBaseUrl}/?folder=${encodeURIComponent(ideWorkspacePath || '/workspace')}&tk=${ideReloadTimestamp}`}
                className="w-full h-full border-0"
                title="ANT Code Editor"
                onLoad={() => {
                  // Mark as loaded to stop auto-retries and prevent flicker
                  useStore.getState().setIdeFrameLoaded(true);
                }}
              />
            )}
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
    </AlertModalProvider>
  );
}

export default App;


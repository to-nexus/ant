import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AppNavBar } from '@/presentation/components/AppNavBar';
import { fetchFeatureSession } from '@/infrastructure/http/api';
import { useStore } from '@/domain/store';
import { useKanban } from '@/application/hooks/features/useKanban';
import { useWorkflow } from '@/application/hooks/features/useWorkflow';
import { useLayoutState } from '@/application/hooks/ui/useLayoutState';
import { useResizeHandlers } from '@/application/hooks/ui/useResizeHandlers';
import { useHealthCheck } from '@/application/hooks/ui/useHealthCheck';
import { useSessionLoader } from '@/application/hooks/ui/useSessionLoader';
import { useJobRestoration } from '@/application/hooks/ui/useJobRestoration';
import { useGitRefresh } from '@/application/hooks/git';
import { ServerDownDetector } from '@/application/hooks/ui/useServerDownDetector';
import { ExplorerPanel } from '@/presentation/components/layout/ExplorerPanel';
import { MainContentArea } from '@/presentation/components/layout/MainContentArea';
import { ChatSidebarWrapper } from '@/presentation/components/layout/ChatSidebarWrapper';
import { LocalSetupGuide } from '@/presentation/pages/LocalSetupGuide';
import { QuickStart } from '@/presentation/pages/QuickStart';
import { ChevronRight } from 'lucide-react';
import { Skeleton, Spinner } from '@/presentation/components/common/async';
import { selectProjectsLoaded } from '@/domain/store/selectors';
import { ProjectWizardModal } from '@/presentation/components/ProjectWizardModal';
import { AlertModalProvider } from '@/presentation/providers/AlertModalProvider';
import { ToastProvider } from '@/presentation/providers/ToastProvider';
import { fetchAuthMe, getBackendMode } from '@/infrastructure/http/api';

function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useTranslation('nav');

  useEffect(() => {
    document.title = t('brand.tabTitle');
  }, [t]);

  // ✅ Handle Google OAuth callback (JWT cookie-based) + session validation on startup
  useEffect(() => {
    const urlParams = new URLSearchParams(location.search);
    const authStatus = urlParams.get('auth');
    const errorParam = urlParams.get('error');
    
    if (authStatus === 'success') {
      (async () => {
        try {
          const user = await fetchAuthMe();
          if (user) {
            const setUser = useStore.getState().setUser;
            setUser(user.email, user.organization);
            
            const fetchProjects = useStore.getState().fetchProjects;
            fetchProjects();
            
            console.log('[Auth] Successfully signed in with Google:', user.email);
          } else {
            console.error('[Auth] Failed to fetch user info after OAuth');
          }
          
          navigate('/', { replace: true });
        } catch (error) {
          console.error('[Auth] Failed to complete OAuth:', error);
        }
      })();
    } else if (errorParam) {
      console.error('[Auth] OAuth error:', errorParam);
      navigate('/', { replace: true });
    } else if (getBackendMode() === 'cloud') {
      (async () => {
        try {
          const user = await fetchAuthMe();
          if (user) {
            if (!useStore.getState().userEmail) {
              useStore.getState().setUser(user.email, user.organization);
              useStore.getState().fetchProjects();
              console.log('[Auth] Restored session from cookie:', user.email);
            }
          } else if (useStore.getState().userEmail) {
            console.warn('[Auth] JWT session expired, clearing stored user');
            useStore.getState().clearUser();
          }
        } catch {
          // Network error — don't clear user (server may be temporarily down)
        }
      })();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
  
  // ✅ Onboarding state
  const userEmail = useStore((state) => state.userEmail);
  const backendMode = useStore((state) => state.backendMode);
  const projects = useStore((state) => state.projects);
  const projectsLoaded = useStore(selectProjectsLoaded);
  
  const onboardingSkipped = useStore((state) => state.onboardingSkipped);
  const setOnboardingSkipped = useStore((state) => state.setOnboardingSkipped);
  const quickStartProjectId = useStore((state) => state.quickStartProjectId);
  const setQuickStartProjectId = useStore((state) => state.setQuickStartProjectId);
  const projectSetupConfig = useStore((state) => state.projectSetupConfig);
  const setProjectSetupConfig = useStore((state) => state.setProjectSetupConfig);

  const shouldShowWelcome = backendMode === 'cloud' && !userEmail;
  // ✅ QuickStart: zero projects (auto) OR opt-in with existing project (quickStartProjectId set)
  const shouldShowQuickStart = !!userEmail && projectsLoaded && !onboardingSkipped
    && (projects.length === 0 || !!quickStartProjectId);
  // Reset skip flag when projects appear (user created one via QuickStart or externally)
  useEffect(() => {
    if (projects.length > 0 && onboardingSkipped) setOnboardingSkipped(false);
  }, [projects.length, onboardingSkipped, setOnboardingSkipped]);

  // ✅ Asymmetric cross-fade between QuickStart ↔ normal UI
  //   Entering QuickStart: instant switch + fade-in (no gap → no flash)
  //   Leaving  QuickStart: fade-out current → swap → fade-in new (350ms)
  const prevShowQuickStartRef = useRef(shouldShowQuickStart);
  const [deferredShowQuickStart, setDeferredShowQuickStart] = useState(shouldShowQuickStart);
  const [viewOpacity, setViewOpacity] = useState<'opacity-0' | 'opacity-100'>('opacity-100');

  useEffect(() => {
    const prev = prevShowQuickStartRef.current;
    prevShowQuickStartRef.current = shouldShowQuickStart;

    if (prev === shouldShowQuickStart) return;

    if (shouldShowQuickStart) {
      // ✅ ENTERING QuickStart — switch immediately, then fade in
      setDeferredShowQuickStart(true);
      setViewOpacity('opacity-0');
      requestAnimationFrame(() => setViewOpacity('opacity-100'));
    } else {
      // ✅ LEAVING QuickStart — fade out, then swap, then fade in
      setViewOpacity('opacity-0');
      const timer = setTimeout(() => {
        setDeferredShowQuickStart(false);
        requestAnimationFrame(() => setViewOpacity('opacity-100'));
      }, 350);
      return () => clearTimeout(timer);
    }
  }, [shouldShowQuickStart]);
  
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

        const { startCloudIDE, SERVER_BASE, RESERVED_FEATURE_NAME } = await import('@/infrastructure/http/api');
        const featureName = selectedFeature || RESERVED_FEATURE_NAME;
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
      // Avoid /workspace/... mapping which causes "Workspace does not exist" after refresh.
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

  // Centralized git auto-refresh: watches selectedProject/selectedFeature and
  // session restore, then fires fetchGitAll + fetchFromRemote. Previously this
  // logic was scattered across ProjectSection/GitStatusButton/useGitChanges
  // with a carrier counter (`gitStatusRefreshTrigger`) and a bypass flag
  // (`bypassFetchTimer`). One hook, one trigger, one dedup key.
  useGitRefresh();

  // ✅ Project config is owned by projectConfigSlice now. MainContentArea
  // subscribes to the slice directly via useAsyncResource and dispatches
  // `updateProjectConfig` on save; no prop drilling from App.tsx needed.

  // ✅ Development: Render tracking for debugging
  if (import.meta.env.DEV && renderCountRef.current > 1) {
    const currentProps = {
      selectedProject,
      selectedFeature,
      selectedFile,
      selectedAgent,
      isRunning,
      kanbanDataSource: kanbanData?.dataSource,
      workflowActiveNodes: workflowData?.activeNodes?.length ?? 0,
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

  if (location.pathname === '/local') {
    return (
      <ToastProvider>
        <AlertModalProvider>
          <>
            <AppNavBar />
            <LocalSetupGuide />
          </>
        </AlertModalProvider>
      </ToastProvider>
    );
  }

  if (shouldShowWelcome) {
    return (
      <ToastProvider>
        <AlertModalProvider>
          <div className="h-screen bg-[#f6f8fa] dark:bg-[#0d1117] flex flex-col transition-colors">
            <AppNavBar />
          </div>
        </AlertModalProvider>
      </ToastProvider>
    );
  }

  // ✅ Boot gate: authenticated but projects not yet loaded — prevent normal
  // UI flash. Uses a delayed spinner (via Spinner primitive) so fast boots
  // don't flicker; the AppNavBar stays mounted to avoid a header jump.
  if (!!userEmail && !projectsLoaded) {
    return (
      <ToastProvider>
        <AlertModalProvider>
          <div className="h-screen bg-[#f6f8fa] dark:bg-[#0d1117] flex flex-col transition-colors">
            <AppNavBar />
            <div className="flex-1 flex items-center justify-center">
              <Spinner size="lg" tone="muted" />
            </div>
          </div>
        </AlertModalProvider>
      </ToastProvider>
    );
  }

  // ✅ Onboarding: QuickStart for authenticated users with no projects OR opt-in with existing project
  // shouldShowQuickStart → immediate entry; deferredShowQuickStart → holds during fade-out
  if (shouldShowQuickStart || deferredShowQuickStart) {
    return (
      <ToastProvider>
        <AlertModalProvider>
          <div className={`h-screen bg-[#f6f8fa] dark:bg-[#0d1117] flex flex-col transition-all duration-350 ${viewOpacity}`}>
            <AppNavBar />
            <QuickStart
              existingProjectId={quickStartProjectId === '__new__' ? undefined : quickStartProjectId}
              onSkip={() => {
                setQuickStartProjectId(undefined);
                setOnboardingSkipped(true);
              }}
            />
          </div>
          {projectSetupConfig && (
            <ProjectWizardModal
              isOpen={!!projectSetupConfig}
              onClose={() => setProjectSetupConfig(undefined)}
              initialMode={projectSetupConfig.mode}
              existingProjectId={projectSetupConfig.existingProjectId}
            />
          )}
        </AlertModalProvider>
      </ToastProvider>
    );
  }

  return (
    <ToastProvider>
    <AlertModalProvider>
      <ServerDownDetector />
      <div
        className="h-screen bg-[#f6f8fa] dark:bg-[#0d1117] flex flex-col transition-colors"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => e.preventDefault()}
      >
        {/* ✅ GNB uses hooks directly - no props needed */}
        <AppNavBar />
        
        {/* Main Layout */}
        {mainView === 'codeIde' ? (
          // ✅ Editor View: OpenVSCode Server iframe
          // ✅ CRITICAL: Use ideReloadTimestamp in key and src to force reload
          // Docker container is shared, timestamp forces VS Code to reload workspace
          <div className={`flex-1 pt-16 transition-opacity duration-350 ${viewOpacity}`}>
            {ideConnecting || !ideBaseUrl ? (
              <IdeLoadingOverlay message={ideConnectError ? 'failed' : 'connecting'} errorMessage={ideConnectError} />
            ) : (
              <div className="relative w-full h-full">
                {!ideFrameLoaded && (
                  <div className="absolute inset-0 flex items-center justify-center bg-white dark:bg-[#0d1117] z-10">
                    <IdeLoadingOverlay message="loading" />
                  </div>
                )}
                <iframe
                  key={`ide-${selectedFeature || 'base'}-${ideReloadTimestamp}`}
                  src={`${ideBaseUrl}/?folder=${encodeURIComponent(ideWorkspacePath || '/workspace')}&tk=${ideReloadTimestamp}`}
                  className="w-full h-full border-0"
                  title="ANT Code Editor"
                  onLoad={() => {
                    useStore.getState().setIdeFrameLoaded(true);
                  }}
                />
              </div>
            )}
          </div>
        ) : (
          // ✅ Agents View: Original UI
        <div className={`flex-1 flex gap-0 overflow-hidden pt-16 transition-opacity duration-350 ${viewOpacity}`}>
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
      {/* ProjectWizardModal (design/code wizard) */}
      {projectSetupConfig && (
        <ProjectWizardModal
          isOpen={!!projectSetupConfig}
          onClose={() => setProjectSetupConfig(undefined)}
          initialMode={projectSetupConfig.mode}
          existingProjectId={projectSetupConfig.existingProjectId}
        />
      )}
    </AlertModalProvider>
    </ToastProvider>
  );
}

/**
 * Small helper used by the codeIde view's loading states. Centralises the
 * skeleton + spinner + i18n message so both the "container starting" and
 * "iframe loading" phases share one visual.
 */
function IdeLoadingOverlay({
  message,
  errorMessage,
}: {
  message: 'connecting' | 'loading' | 'failed';
  errorMessage?: string;
}) {
  const { t } = useTranslation('async');
  const text =
    message === 'failed'
      ? t('ide.failed', { message: errorMessage ?? '' })
      : message === 'connecting'
        ? t('ide.connecting')
        : t('ide.loading');
  return (
    <div className="w-full h-full flex items-center justify-center">
      <div className="max-w-lg w-full px-6">
        <div className="rounded-xl border border-gray-200 dark:border-[#30363d] bg-white dark:bg-[#161b22] p-6 shadow-sm">
          <Skeleton variant="text" className="w-44 mb-4" />
          <Skeleton variant="text" className="w-full mb-2" delayMs={80} />
          <Skeleton variant="text" className="w-5/6 mb-6" delayMs={160} />
          <div className="text-sm text-gray-600 dark:text-gray-300">{text}</div>
        </div>
      </div>
    </div>
  );
}

export default App;


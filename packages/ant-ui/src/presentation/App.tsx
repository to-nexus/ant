import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Route, Routes, useLocation, useNavigate } from 'react-router-dom';
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
import { useProjectLifecycle } from '@/domain/project-world';
import { usePreviewSync } from '@/application/hooks/preview/usePreviewSync';
import { useExplicitAutoSync } from '@/application/hooks/ui/useExplicitAutoSync';
import { ServerDownDetector } from '@/application/hooks/ui/useServerDownDetector';
import { ExplorerPanel } from '@/presentation/components/layout/ExplorerPanel';
import { MainContentArea } from '@/presentation/components/layout/MainContentArea';
import { ChatSidebarWrapper } from '@/presentation/components/layout/ChatSidebarWrapper';
import { QuickStart } from '@/presentation/pages/QuickStart';
import { ChevronRight } from 'lucide-react';
import { Spinner } from '@/presentation/components/common/async';
import { selectProjectsLoaded } from '@/domain/store/selectors';
import {
  useIdeBaseUrl,
  useIdeOverlayMode,
  useIdeReloadTimestamp,
  useIdeWorkspacePath,
} from '@/domain/store/selectors/ideSelectorHooks';
import { useIdeHealthMonitor } from '@/application/hooks/ide/useIdeHealthMonitor';
import { useIdeStuckDetector } from '@/application/hooks/ide/useIdeStuckDetector';
import { IdeConnectionPanel } from '@/presentation/components/common/ide/IdeConnectionPanel';
import { IdeFrame } from '@/presentation/components/FileEditorPanel/IdeFrame';
import { ProjectWizardModal } from '@/presentation/components/ProjectWizardModal';
import { AlertModalProvider } from '@/presentation/providers/AlertModalProvider';
import { ToastProvider } from '@/presentation/providers/ToastProvider';
import { OrganizationOnboardingScreen } from '@/presentation/components/auth/OrganizationOnboardingScreen';
import {
  clearOnboardingQueryFlag,
  shouldShowOnboarding,
} from '@/application/auth/onboardingRouter';
import { fetchAuthMeDetailed, API_BASE } from '@/infrastructure/http/api';
import type { AuthMeResult } from '@/infrastructure/http/api/auth';
import { selectIsAuthBlocked, selectServerMode } from '@/domain/store/selectors';
import {
  getAuthBroadcaster,
  markSessionExpired,
  clearSessionExpired,
} from '@/infrastructure/auth/authBridge';

/**
 * Single sink for the diagnostic log emitted whenever `/auth/me` returns
 * something other than a real user. The structured fields are the
 * 4-quadrant truth table inputs (see plan: cloud-mode-stateless-crown):
 *
 *   apiBase=/api  → `VITE_CLOUD_BACKEND_BASE` not baked into the dist
 *   kind=network  → CORS preflight blocked or backend host unreachable
 *   kind=no-session → cookie not arriving on /auth/me (scope/secure)
 *   kind=misconfigured → ANT_JWT_SECRET unset on backend
 */
function logAuthFailure(phase: 'post-oauth' | 'mount', result: AuthMeResult): void {
  const status = result.kind === 'http-error' ? result.status : '';
  const detail = result.kind === 'network' ? ` message="${result.message}"` : '';
  console.error(
    `[Auth] me-fetch failed phase=${phase} kind=${result.kind} status=${status} origin=${window.location.origin} apiBase=${API_BASE()}${detail}`
  );
}

const AuroraCasesDevPage = import.meta.env.DEV
  ? lazy(() => import('@/presentation/pages/dev/AuroraCases'))
  : null;

function App() {
  const { t } = useTranslation('nav');

  useEffect(() => {
    document.title = t('brand.tabTitle');
  }, [t]);

  return (
    <Routes>
      <Route
        path="/dev/aurora-cases"
        element={
          import.meta.env.DEV && AuroraCasesDevPage ? (
            <Suspense
              fallback={
                <div style={{ padding: 24, color: 'var(--text-3)' }}>
                  Loading Aurora cases…
                </div>
              }
            >
              <AuroraCasesDevPage />
            </Suspense>
          ) : (
            <div style={{ padding: 24 }}>Not available in production build.</div>
          )
        }
      />
      <Route path="*" element={<AppShell />} />
    </Routes>
  );
}

function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();

  // ✅ Cross-tab auth bridge — react to `logout` / `session-expired` posted
  // from another tab. The dispatching tab runs cleanup directly via
  // `runUnifiedLogout` / 401 interceptor; this subscriber is for the
  // OBSERVING tabs. We do NOT re-broadcast and do NOT navigate (let the
  // user keep their page state but see the logged-out shell).
  useEffect(() => {
    const broadcaster = getAuthBroadcaster();
    const unsub = broadcaster.subscribe((message) => {
      if (message.type === 'logout' || message.type === 'session-expired') {
        if (message.type === 'session-expired') markSessionExpired();
        const state = useStore.getState() as any;
        if (typeof state.clearUser === 'function') state.clearUser();
      }
    });
    return () => {
      unsub();
    };
  }, []);

  // ✅ Billing deep-link (`/app/billing`, used by ant-site plan CTAs) — open the
  // billing main-panel tab and redirect into the app shell. Billing is no longer
  // a standalone page; it lives as a tab like every other secondary surface.
  useEffect(() => {
    if (location.pathname === '/billing') {
      useStore.getState().openMainPanelTab('billing');
      navigate('/', { replace: true });
    }
  }, [location.pathname, navigate]);

  // ✅ Handle Google OAuth callback (always relevant regardless of BE mode —
  // the URL param itself is the trigger; if a callback landed in a local-mode
  // build, the BE will simply respond 'no-session' to fetchAuthMeDetailed).
  useEffect(() => {
    const urlParams = new URLSearchParams(location.search);
    const oauthCallback = urlParams.get('auth');
    const errorParam = urlParams.get('error');

    if (oauthCallback === 'success') {
      useStore.getState().setAuthStatus('verifying');
      (async () => {
        const result = await fetchAuthMeDetailed();
        if (result.kind === 'user') {
          clearSessionExpired();
          useStore.getState().setUser(
            result.user.email,
            result.user.organization,
            result.user.name,
            result.user.picture,
            result.user.userId,
            result.user.orgKind,
            result.memberships,
          );
          useStore.getState().setOnboardingState(
            result.needsOnboarding,
            result.suggestedOrganizationName,
          );
          if (!result.needsOnboarding) {
            useStore.getState().fetchProjects();
          }
          console.log('[Auth] Successfully signed in with Google:', result.user.email);
        } else {
          logAuthFailure('post-oauth', result);
          useStore.getState().setAuthStatus('idle');
        }
        clearOnboardingQueryFlag();
        navigate('/', { replace: true });
      })();
    } else if (errorParam) {
      console.error('[Auth] OAuth error:', errorParam);
      useStore.getState().setAuthStatus('idle');
      navigate('/', { replace: true });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ✅ Cloud-mode session validation on startup. Waits for the BE-derived
  // `serverMode` (loaded by useHealthCheck → loadSystemConfig) so we never
  // fire `/auth/me` against a local-mode BE that doesn't issue cookies.
  // Local mode goes straight to 'idle' — no cookie session to verify.
  const verifyServerMode = useStore((state) => selectServerMode(state));
  useEffect(() => {
    if (verifyServerMode === null) return; // wait for BE config

    const urlParams = new URLSearchParams(location.search);
    if (urlParams.get('auth') === 'success' || urlParams.get('error')) return;

    if (verifyServerMode === 'local') {
      useStore.getState().setAuthStatus('idle');
      return;
    }

    useStore.getState().setAuthStatus('verifying');
    (async () => {
      const result = await fetchAuthMeDetailed();
      if (result.kind === 'user') {
        const hadEmail = !!useStore.getState().userEmail;
        useStore.getState().setOnboardingState(
          result.needsOnboarding,
          result.suggestedOrganizationName,
        );
        // Always re-`setUser` so `userName` / `userPicture` (not persisted in
        // localStorage) are refreshed on every mount. The store seeds
        // `userEmail` from localStorage but `name` / `picture` arrive only
        // via BE round-trip, so a refresh would otherwise leave the avatar
        // blank even with a valid session.
        useStore.getState().setUser(
          result.user.email,
          result.user.organization,
          result.user.name,
          result.user.picture,
          result.user.userId,
          result.user.orgKind,
          result.memberships,
        );
        if (!hadEmail) {
          if (!result.needsOnboarding) {
            useStore.getState().fetchProjects();
          }
          console.log('[Auth] Restored session from cookie:', result.user.email);
        }
      } else if (result.kind === 'no-session') {
        if (useStore.getState().userEmail) {
          console.warn('[Auth] JWT session expired, clearing stored user');
          useStore.getState().clearUser();
        } else {
          useStore.getState().setAuthStatus('idle');
        }
      } else {
        logAuthFailure('mount', result);
        useStore.getState().setAuthStatus('idle');
      }
      clearOnboardingQueryFlag();
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verifyServerMode]);
  
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
    expandChat,
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
  const mainView = useStore((state) => state.mainView);
  
  // ✅ Onboarding state
  const userEmail = useStore((state) => state.userEmail);
  const serverMode = useStore((state) => selectServerMode(state));
  const authStatusValue = useStore((state) => state.authStatus);
  const needsOnboarding = useStore((state) => state.needsOnboarding);
  const projects = useStore((state) => state.projects);
  const projectsLoaded = useStore(selectProjectsLoaded);
  
  const onboardingSkipped = useStore((state) => state.onboardingSkipped);
  const setOnboardingSkipped = useStore((state) => state.setOnboardingSkipped);
  const quickStartProjectId = useStore((state) => state.quickStartProjectId);
  const setQuickStartProjectId = useStore((state) => state.setQuickStartProjectId);
  const projectSetupConfig = useStore((state) => state.projectSetupConfig);
  const setProjectSetupConfig = useStore((state) => state.setProjectSetupConfig);

  // Welcome screen surfaces ONLY for resolved cloud BEs with no signed-in
  // user. While `serverMode` is null (config still loading), don't flash
  // the welcome — keep the app in its neutral state.
  const shouldShowWelcome = serverMode === 'cloud' && !userEmail;
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
  
  const ideWorkspacePath = useIdeWorkspacePath();
  const setIdeWorkspacePath = useStore((state) => state.setIdeWorkspacePath);
  const ideReloadTimestamp = useIdeReloadTimestamp();
  const ideBaseUrl = useIdeBaseUrl();
  const overlayMode = useIdeOverlayMode();

  // ✅ Health monitor — 30s probe + SSE soft-disconnect signal. Active only
  // while the IDE session is `connected`; the hook gates internally.
  useIdeHealthMonitor();
  // ✅ Stuck detector — per-phase thresholds (pod-pending 45s, image-pulling
  // 180s, etc.). Marks the session stuck if the current phase doesn't
  // advance, surfacing the "Force reset" CTA in IdeConnectionPanel.
  useIdeStuckDetector();

  // ✅ Refresh-safe: if we reload while in codeIde view, re-connect to IDE
  // automatically. `startIdeSession` handles the inflight/idempotent guards
  // internally so we don't need to gate here beyond "do we have a baseUrl?".
  // overlayMode === 'hidden' folds both `idle` and `connected` together — we
  // discriminate by `ideBaseUrl` (idle has none, connected has it).
  useEffect(() => {
    if (mainView !== 'codeIde') return;
    if (!selectedProject) return;
    if (overlayMode !== 'hidden') return;
    if (ideBaseUrl) return; // already connected
    void useStore.getState().startIdeSession(selectedProject, selectedFeature || undefined);
  }, [mainView, selectedProject, selectedFeature, overlayMode, ideBaseUrl]);
  
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

  // ✅ Health check (extracted to hook) — also performs system config load.
  useHealthCheck();

  // ✅ Session restoration (extracted to hook)
  useSessionLoader(connectionStatus);

  // ✅ Job restoration (extracted to hook)
  useJobRestoration({ 
    connectionStatus,
    selectedProject: selectedProject || null,
    selectedFeature: selectedFeature || null
  });

  // Single orchestrator for `(project, feature)` transitions. Replaces the
  // pre-greenfield tangle of refresh hooks with one effect that:
  //   1. resets git-world state for the new identity
  //   2. reconnects SSE (server publishes `reconnectRefill` on open)
  //   3. primes project config + authoritative git state
  // See `docs/architecture/24-git-operations.md §0` and
  // `src/domain/project-world/lifecycle.ts`.
  useProjectLifecycle();

  // Ambient preview sync — single writer for SSE / initial fetch / visibility
  // / reconnect. Lives at app root so it survives Explorer collapse and any
  // preview-config-editor mount/unmount. See `usePreviewSync` header.
  usePreviewSync();

  // Ambient explicit auto-sync: maintains the invariant that
  // `actionMetadata.explicit === true` ⇔ metadata is complete enough to
  // bypass triage. Rising edge auto-set, falling edge auto-clear; manual
  // removal is preserved and rising edge is only ever fired once per edge.
  useExplicitAutoSync();

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

      // Stale-session guard. Cloud + no userEmail = the JWT cookie is
      // gone or expired; the session fetch would 401 and pollute the
      // console while clearUser's cascade is still landing.
      if (selectIsAuthBlocked(useStore.getState())) return;

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

  if (shouldShowWelcome) {
    // Cloud-mode + no signed-in user: the AppNavBar carries the Sign In
    // button (Google OIDC), so we keep it mounted and leave the body
    // empty. Marketing surface lives on ant-site (`/`); users that need
    // it navigate there explicitly. See e27f0ff7.
    return (
      <ToastProvider>
        <AlertModalProvider>
          <div
            className="h-screen flex flex-col transition-colors"
            style={{ background: 'var(--bg-canvas)' }}
          >
            <AppNavBar />
          </div>
        </AlertModalProvider>
      </ToastProvider>
    );
  }

  // Phase 3 — cloud-mode signed-in user with a `_pending` JWT must
  // complete organization onboarding before the normal UI mounts. This
  // also covers the `?onboarding=true` post-OAuth redirect because the
  // mount-time `/auth/me` fetch has set `needsOnboarding` already.
  if (shouldShowOnboarding({ serverMode, userEmail, needsOnboarding })) {
    return (
      <ToastProvider>
        <AlertModalProvider>
          <OrganizationOnboardingScreen />
        </AlertModalProvider>
      </ToastProvider>
    );
  }

  // ✅ Boot gate: hide the normal UI while either
  //   (a) cloud-mode JWT verification is still in flight (`authStatus === 'verifying'`), or
  //   (b) authenticated user is set but projects haven't loaded yet.
  // (a) prevents the lifecycle race where stale `selectedProject` would
  // fan out protected requests under a soon-to-be-cleared session; (b)
  // is the legacy first-fetch flash guard. Uses a delayed spinner so fast
  // boots don't flicker; the AppNavBar stays mounted to avoid a header jump.
  if (authStatusValue === 'verifying' || (!!userEmail && !projectsLoaded)) {
    return (
      <ToastProvider>
        <AlertModalProvider>
          <div
            className="h-screen flex flex-col transition-colors"
            style={{ background: 'var(--bg-canvas)' }}
          >
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
          <div
            className={`h-screen flex flex-col transition-all duration-350 ${viewOpacity}`}
            style={{ background: 'var(--bg-canvas)' }}
          >
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
        className="h-screen flex flex-col transition-colors"
        style={{ background: 'var(--bg-canvas)' }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => e.preventDefault()}
      >
        {/* ✅ GNB uses hooks directly - no props needed */}
        <AppNavBar />
        
        {/* Main Layout — both views are always mounted; `display` toggles
            visibility so the IDE iframe (VSCode session + WebSocket) survives
            tab switches. Re-mount is triggered only by feature change or an
            explicit reload, both via `ideReloadTimestamp` bumps in the key.
            See `.claude/plans/ant-ide-pwd-iterative-flute.md` for rationale. */}

        {/* IDE View */}
        <div
          className={`flex-1 pt-14 transition-opacity duration-350 ${viewOpacity}`}
          style={{ display: mainView === 'codeIde' ? 'block' : 'none' }}
        >
          <div className="relative w-full h-full">
            <IdeFrame
              projectId={selectedProject}
              featureName={selectedFeature || undefined}
              ideBaseUrl={ideBaseUrl}
              ideWorkspacePath={ideWorkspacePath}
              ideReloadTimestamp={ideReloadTimestamp}
            />
            {overlayMode !== 'hidden' && selectedProject && (
              <IdeConnectionPanel
                projectId={selectedProject}
                featureName={selectedFeature || undefined}
              />
            )}
          </div>
        </div>

        {/* Agents View */}
        <div
          className={`flex-1 gap-0 overflow-hidden pt-14 transition-opacity duration-350 ${viewOpacity}`}
          style={{ display: mainView !== 'codeIde' ? 'flex' : 'none' }}
        >
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
            <div
              className="w-10 flex flex-col items-center shrink-0 transition-colors shadow-sm"
              style={{ background: 'var(--bg-surface)', borderRight: '1px solid var(--border-1)' }}
            >
              <button
                onClick={() => {
                  setIsExplorerCollapsed(false);
                  setExplorerWidth(320);
                }}
                className="h-10 w-10 flex items-center justify-center text-[color:var(--text-3)] hover:text-gray-700 transition-colors"
                style={{ background: 'var(--bg-surface-2)', borderBottom: '1px solid var(--border-1)' }}
                title="Expand Explorer"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Main Content Area */}
          <MainContentArea
            connectionStatus={connectionStatus}
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
            onExpand={expandChat}
            onCollapse={() => setIsChatCollapsed(true)}
            onResizeStart={() => setIsResizingChat(true)}
          />
        </div>
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

export default App;


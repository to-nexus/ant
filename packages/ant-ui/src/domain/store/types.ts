import { Session } from '@/domain/models/session';
import { Feature, FileNode, PreviewStatus, KanbanData } from '@/infrastructure/http/api';
import { JobExecution } from '@/infrastructure/http/cli';
import type { ChatLine } from '@ant/shared';
import type { BufferKey, StreamingBuffer } from '@/domain/store/selectors/chat';
import type { ViewMode } from '@/domain/file/viewMode';
import type { CurrentFileState } from './slices/fileSlice';

// ==================
// Store State Types
// ==================

export interface ProjectState {
  projects: string[];
  /**
   * AsyncStatus of the first `fetchProjects` call. Replaces the legacy
   * `projectsLoaded: boolean`. `selectProjectsLoaded` preserves the old
   * "first fetch completed" semantics for consumers that don't care about
   * success vs. failure.
   */
  projectsStatus: import('@/domain/async').AsyncStatus;
  selectedProject: string | undefined;
  selectedFeature: string | undefined;
  features: Feature[];
  // ✅ Session restore tracking
  isSessionRestoring: boolean;  // Session restore가 진행 중인지
  sessionRestoreCompleted: boolean;  // Session restore가 완료되었는지 (한 번만 true)
  expectedFeatureAfterRestore: string | undefined;  // Session restore 시 기대하는 feature
}

export interface FileState {
  selectedFile: string | undefined;
  fileTree: FileNode[];
  /**
   * AsyncFields<FileResource> + dirty buffer + save status — the single
   * source of truth for the file the editor is displaying. See
   * slices/fileSlice.ts and docs/architecture/ui-async-policy.md.
   */
  currentFile: CurrentFileState;
  viewModeByPath: Record<string, ViewMode>;
  unseenArtifacts: string[];  // Unseen artifact file paths for badge notifications
  figmaPopulated: boolean | null;  // null=loading, true=has files, false=empty/error
}

export interface QueuePosition {
  status: string;
  position: number | null;
  totalWaiting: number;
}

export interface InlineAskContext {
  interruptedJobId: string;
  projectId: string;
  featureName: string;
  message: string;
}

export interface ActiveJobEntry {
  jobId: string;
  status: string;
  agent?: string;
}

export interface JobState {
  session: Session | undefined;
  isRunning: boolean;
  isStopping: boolean;
  isQueued: boolean;  // Job is waiting in queue
  queuePosition: QueuePosition | null;
  userStoppedJobId: string | null;
  lastJobFailed: boolean;
  dismissedInterruptTimestamp: string | null;
  runningJobsByFeature: Record<string, string>;
  currentJobId: string | undefined;
  currentJob: JobExecution | null;
  taskStartTime: number | undefined;
  elapsedTime: number;
  currentMode: 'generate' | 'refactor' | 'explain' | undefined;
  // ✅ Cloud multi-pod: Protects isRunning from SSE overwrite until actual job starts
  jobStartPending: boolean;
  // ✅ Cloud multi-pod: Protects isRunning from stale initial data after SSE reconnect
  sseReconnectGrace: boolean;
  // ✅ Inline Ask: Context for handling ask during interrupted jobs
  inlineAskContext: InlineAskContext | null;
  // N concurrent jobs: per-jobType tracking within current feature
  activeJobs: Record<string, ActiveJobEntry>;
}

export interface SSEState {
  kanban: KanbanData;
  /**
   * Finalized chat.jsonl events received over SSE. Phase 10 substrate.
   * Folded into `Turn[]` via `selectTurns(state)`.
   */
  chatEvents: ChatLine[];
  /**
   * In-flight streaming buffers keyed by `${turnId}:${workerScope}`.
   * Mirrors the BE Redis TURN_BUFFER. Cleared on `events_cleared` and
   * on per-buffer `clearStreamingBuffer`.
   */
  streamingBuffers: Record<BufferKey, StreamingBuffer>;
  /**
   * Server-issued monotonic timestamp from the last `chat_initial_state`
   * snapshot. Streaming deltas with `producedAt < lastChatSnapshotTs`
   * are dropped (would predate the snapshot).
   */
  lastChatSnapshotTs?: string;
  connectionStatus: 'connected' | 'disconnected' | 'error';
}

export type StaticMainPanelTab =
  | 'job'
  | 'projectConfig'
  | 'accountConfig'
  | 'fileEdit'
  | 'transfer'
  | 'previewConfig'
  | 'actions';

export type EditorMainPanelTabId = `editor:${string}`;
export type MainPanelTabId = StaticMainPanelTab | EditorMainPanelTabId;
export type MainPanelTabOrderItem = Exclude<MainPanelTabId, 'job'>;

/**
 * IDE session lifecycle — discriminated union, the SSOT for every IDE
 * lifecycle UI signal (startup phase / iframe load / disconnect / failure).
 *
 * Reads MUST go through `domain/store/selectors/ideSelectors.ts`; direct
 * `state.ideSession.kind === '...'` reads outside that module are forbidden.
 * Writes go through the typed actions on UISlice.
 *
 * `sessionKey = ${projectId}:${featureName}` lets stale-start guards (BE SSE
 * matching, App.tsx visibility checks) discriminate this session from a
 * previous one without leaking startedAt / baseUrl identity comparisons.
 */
export type IdeSessionState =
  | { kind: 'idle' }
  | { kind: 'starting'; phase: import('@ant/shared').IdePhase | null; startedAt: number; sessionKey: string; stuckSince?: number }
  | { kind: 'frameLoading'; baseUrl: string; mountedAt: number; sessionKey: string }
  | { kind: 'connected'; baseUrl: string; sessionKey: string }
  | { kind: 'disconnected'; baseUrl: string; sessionKey: string; detectedAt: number; signal: 'probe-dead' | 'sse-channel-down' | 'iframe-error' }
  | { kind: 'reconnecting'; baseUrl: string; sessionKey: string; attemptStartedAt: number }
  | { kind: 'failed'; error: string; previousBaseUrl?: string };

/**
 * Project deletion lifecycle — discriminated union mirroring the BE cascade.
 *
 * `sessionKey = projectId` (only one deletion can run per project at a time).
 * The SSE handler in `sseSlice` drops events whose sessionKey doesn't match
 * the current `deleting` session, so a late-arriving event for a previously
 * cancelled deletion can never overwrite the UI.
 *
 * `phaseHistory` tracks which phases completed/failed so the step rail can
 * mark them appropriately even when the SSE stream is reconnected mid-flight.
 */
export type ProjectDeletionPhaseSnapshot = import(
  '@/presentation/components/common/async/PhasedOperationSession'
).PhasedOperationPhaseSnapshot<import('@ant/shared').ProjectDeletionPhase>;

type _ProjectDeletionGeneric = import(
  '@/presentation/components/common/async/PhasedOperationSession'
).PhasedOperationSession<import('@ant/shared').ProjectDeletionPhase>;

/**
 * Domain session = generic phased-operation session + project identity
 * fields on every non-idle variant. The generic part is reused by
 * `<PhasedOperationPanel>`; `projectId` lets selectors / panel body
 * interpolation know which project the cascade is for.
 */
export type ProjectDeletionSession =
  | Extract<_ProjectDeletionGeneric, { kind: 'idle' }>
  | (Exclude<_ProjectDeletionGeneric, { kind: 'idle' | 'completed' }> & { projectId: string })
  | (Extract<_ProjectDeletionGeneric, { kind: 'completed' }> & { projectId: string });

export type FeatureDeletionPhaseSnapshot = import(
  '@/presentation/components/common/async/PhasedOperationSession'
).PhasedOperationPhaseSnapshot<import('@ant/shared').FeatureDeletionPhase>;

type _FeatureDeletionGeneric = import(
  '@/presentation/components/common/async/PhasedOperationSession'
).PhasedOperationSession<import('@ant/shared').FeatureDeletionPhase>;

/**
 * Feature deletion session — mirrors `ProjectDeletionSession` over the
 * feature scope. Identity carries both `projectId` and `featureName` so
 * the SSE handler can dedup by `${projectId}:${featureName}` and the
 * panel body can render either id.
 */
export type FeatureDeletionSession =
  | Extract<_FeatureDeletionGeneric, { kind: 'idle' }>
  | (Exclude<_FeatureDeletionGeneric, { kind: 'idle' | 'completed' }> & { projectId: string; featureName: string })
  | (Extract<_FeatureDeletionGeneric, { kind: 'completed' }> & { projectId: string; featureName: string });

export interface UIState {
  theme: 'light' | 'dark';
  language: 'en' | 'ko';
  splitLayout: 'horizontal' | 'vertical';
  taskViewMode: 'kanban' | 'workflow';
  mainView: 'agents' | 'codeIde';
  // SSOT for IDE lifecycle — see `IdeSessionState`. Use selectors from
  // `domain/store/selectors/ideSelectors.ts`; do NOT read kind/baseUrl/etc
  // directly from this field outside the selectors module.
  ideSession: IdeSessionState;
  // Orthogonal to ideSession lifecycle — user's selected workspace path,
  // preserved across sessions. Set on first session and rehydrated thereafter.
  ideWorkspacePath: string | undefined;
  // iframe force-remount trigger — bumped by `bumpIdeReloadTimestamp()` when
  // we want the iframe to reload but stay on the same baseUrl (post-reconnect
  // success). Combined with baseUrl as the iframe `key`.
  ideReloadTimestamp: number;
  mainPanelActiveTab: MainPanelTabId;
  mainPanelOpenTabs: {
    projectConfig: boolean;
    accountConfig: boolean;
    fileEdit: boolean;
    transfer: boolean;
    previewConfig: boolean;
    actions: boolean;
  };
  mainPanelTabOrder: MainPanelTabOrderItem[];
  // Actions panel state
  actionsStep: 'pick-action' | 'pick-intent' | 'config' | 'basis-edit';
  // Ephemeral: which tier the basis wizard should land on when entering
  // 'basis-edit'. Set by tier-specific edit buttons (BasisSummaryBar). Cleared
  // by the wizard itself or by global edit triggers that don't target a tier.
  basisEditInitialTier: 'techTier' | 'visualTier' | 'gameArtTier' | 'gameContentTier' | undefined;
  selectedActionId: string | null;
  selectedIntentId: string | null;
  actionMetadata: import('@ant/shared').ActionMetadata;
  highlightedArtifactDirs: string[];
  spotlightTarget: { type: 'file' | 'dir'; path: string } | null;
  // Expanded directories in the Artifacts tree. Lifted from ArtifactsSection
  // component-local state so it survives transient remounts of the panel
  // (e.g. connectionStatus flicker), which would otherwise reset the user's
  // expand selection. Reducer-side no-op guards keep ref-stability when the
  // requested mutation is a no-op.
  expandedArtifactDirs: ReadonlySet<string>;
  // ✅ Pending clarify answers (shared between compound ChoiceCard and ChatInput)
  pendingClarifyAnswers: Record<number, string>;  // questionIndex → selected answer
  pendingClarifyQuestions: string[];  // original question texts (for combining with free input)
  // ✅ Onboarding skip (user chose to skip QuickStart and go to empty workspace)
  onboardingSkipped: boolean;
  // ✅ QuickStart with existing project (non-null triggers QuickStart for that project)
  quickStartProjectId: string | undefined;
  // ✅ ProjectWizard modal (design/code wizard)
  projectSetupConfig: {
    mode: 'design' | 'code';
    existingProjectId?: string;
  } | undefined;
  // ✅ Figma integration bridge state (global single source of truth)
  bridgeConnected: boolean | null;       // null=unchecked, false=disconnected, true=connected
  bridgeDetected: boolean;
  figmaDesktopReachable: boolean;
  accountConfigScrollTarget: string | null;
  editorTabs: EditorTab[];
  activeEditorTabId: string | null;
}

export interface EditorTab {
  id: string;
  title: string;
  path?: string;
  kind: 'real' | 'virtual';
  pinned: boolean;
  readOnly: boolean;
  cardId?: string;
  turnId?: string;
  jobId?: string;
  source?: 'plan' | 'design';
  status?: 'streaming' | 'ready';
  content?: string;
  streamPreviewContent?: string;
  streamingSourceCardId?: string;
}

// Git state moved to `domain/git-world/**`. See
// `docs/architecture/24-git-operations.md §0` for the SSOT contract.

export interface PerFeaturePreviewState {
  status: PreviewStatus | undefined;
  isLoading: boolean;
  stopGuardUntil: number;
}

export interface PreviewSliceState {
  /** Map keyed by `${projectId}:${featureName}` — isolates state per feature. */
  previewByFeature: Record<string, PerFeaturePreviewState>;
}

export interface PerFeatureDeployState {
  status: import('@/infrastructure/http/api').DeployStatus | undefined;
  logs: import('@/infrastructure/http/api').DeployLogEntry[];
  isLoading: boolean;
}

export interface DeploySliceState {
  /** Map keyed by `${projectId}:${featureName}` — isolates state per feature. */
  deployByFeature: Record<string, PerFeatureDeployState>;
}

export type AuthStatus = 'idle' | 'verifying' | 'verified' | 'expired';

export interface AuthState {
  userEmail: string | undefined;
  userOrganization: string | undefined;
  userName: string | undefined;
  userPicture: string | undefined;
  /**
   * Cloud-mode JWT verification status. Mirrors the `systemConfigStatus`
   * pattern (idle/loading/ready/error) but with semantics that match the
   * lifecycle race fixed by plan `stale-session-lifecycle-cascade`:
   *   - `'idle'`     — local mode, or no stale session to re-check.
   *   - `'verifying'`— mount-time `fetchAuthMe()` is in flight (cloud only).
   *                    Lifecycle hooks must NOT fire protected requests
   *                    until this transitions to `'verified'`.
   *   - `'verified'` — cookie verified, `userEmail` is fresh.
   *   - `'expired'`  — cookie absent / 401, `clearUser` cascade has run.
   *
   * `selectIsAuthBlocked` treats `'verifying'` the same as
   * "cloud + no userEmail", so a single selector keeps both the stale-
   * session and verification-window cases out of lifecycle fan-out.
   */
  authStatus: AuthStatus;
  /**
   * Phase 3 onboarding state — mirror of the BE `_pending` JWT
   * sentinel. `true` means the user is signed in but has not yet
   * completed `POST /auth/onboarding/organization`, so the App should
   * render `OrganizationOnboardingScreen` instead of the normal UI.
   */
  needsOnboarding: boolean;
  /**
   * Server-supplied default for the onboarding input. `null` for
   * consumer emails (no sensible default — user must type a name) and
   * for the post-onboarding state.
   */
  suggestedOrganizationName: string | null;
  selectedAgent: string;
  selectedJobType: 'design' | 'code' | 'learn' | 'plan' | 'visual';
}

export interface ConfigState {
  recursionLimit: number;
  /** AsyncStatus of `loadSystemConfig`. Unused by UI today but kept as SSOT. */
  systemConfigStatus: import('@/domain/async').AsyncStatus;
  /**
   * BE-derived server mode (`ANT_SERVER_MODE`). SSOT lives on the BE —
   * FE fetches it via `GET /system/config` and stores it read-only. There
   * is no user toggle and no localStorage persistence; mode is fixed at
   * BE startup time.
   */
  serverMode: import('@/domain/async').AsyncFields<import('@ant/shared').ServerMode>;
  localBackendPort: number;
}

// ==================
// Combined State
// ==================

export type StoreState = ProjectState & 
  FileState & 
  JobState & 
  SSEState & 
  UIState & 
  PreviewSliceState & 
  DeploySliceState &
  AuthState & 
  ConfigState;


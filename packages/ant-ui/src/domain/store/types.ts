import { Session } from '@/domain/models/session';
import { Feature, FileNode, PreviewStatus, KanbanData } from '@/infrastructure/http/api';
import { JobExecution } from '@/infrastructure/http/cli';
import type { ChatLine } from '@ant/shared';
import type { BufferKey, StreamingBuffer } from '@/domain/store/selectors/chat';
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
  lastViewMode: 'raw' | 'preview';
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

export interface UIState {
  theme: 'light' | 'dark';
  language: 'en' | 'ko';
  splitLayout: 'horizontal' | 'vertical';
  showWorkflow: boolean;
  mainView: 'agents' | 'codeIde';
  ideBaseUrl: string | undefined; // ✅ Cloud IDE: direct URL returned from /api/cloud-ide/start
  ideWorkspacePath: string | undefined;
  ideReloadTimestamp: number; // ✅ Add timestamp to force IDE reload
  ideConnecting: boolean; // ✅ show skeleton while IDE container is starting
  ideConnectError: string | undefined;
  ideFrameLoaded: boolean; // ✅ iframe onLoad succeeded (prevents unnecessary auto-retries)
  mainPanelActiveTab: 'job' | 'projectConfig' | 'accountConfig' | 'fileEdit' | 'transfer' | 'previewConfig' | 'actions';
  mainPanelOpenTabs: {
    projectConfig: boolean;
    accountConfig: boolean;
    fileEdit: boolean;
    transfer: boolean;
    previewConfig: boolean;
    actions: boolean;
  };
  mainPanelTabOrder: Array<'projectConfig' | 'accountConfig' | 'fileEdit' | 'transfer' | 'previewConfig' | 'actions'>;
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

export interface AuthState {
  userEmail: string | undefined;
  userOrganization: string | undefined;
  selectedAgent: string;
  selectedJobType: 'design' | 'code' | 'learn' | 'plan' | 'visual';
}

export interface ConfigState {
  recursionLimit: number;
  /** AsyncStatus of `loadSystemConfig`. Unused by UI today but kept as SSOT. */
  systemConfigStatus: import('@/domain/async').AsyncStatus;
  backendMode: 'local' | 'cloud';
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


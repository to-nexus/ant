import { Session } from '@/domain/models/session';
import { Feature, FileNode, FileContent, PreviewStatus, KanbanData } from '@/infrastructure/http/api';
import { JobExecution } from '@/infrastructure/http/cli';
import type { ChatMessage } from '@/domain/models/chat';

// ==================
// Store State Types
// ==================

export interface ProjectState {
  projects: string[];
  projectsLoaded: boolean;  // ✅ true after first fetchProjects completes (prevents QuickStart flash)
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
  fileContent: FileContent | undefined;
  fileReloadTrigger: number;
  fileReloadTarget: string | undefined;
  lastViewMode: 'raw' | 'preview';
  unseenArtifacts: string[];  // Unseen artifact file paths for badge notifications
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
}

export interface SSEState {
  kanban: KanbanData;
  chatMessages: ChatMessage[];
  connectionStatus: 'connected' | 'disconnected' | 'error';
}

export interface UIState {
  theme: 'light' | 'dark';
  language: 'en' | 'ko';
  splitLayout: 'horizontal' | 'vertical';
  mainView: 'agents' | 'codeIde';
  ideBaseUrl: string | undefined; // ✅ Cloud IDE: direct URL returned from /api/cloud-ide/start
  ideWorkspacePath: string | undefined;
  ideReloadTimestamp: number; // ✅ Add timestamp to force IDE reload
  ideConnecting: boolean; // ✅ show skeleton while IDE container is starting
  ideConnectError: string | undefined;
  ideFrameLoaded: boolean; // ✅ iframe onLoad succeeded (prevents unnecessary auto-retries)
  mainPanelActiveTab: 'job' | 'projectConfig' | 'accountConfig' | 'fileEdit' | 'transfer' | 'previewConfig';
  mainPanelOpenTabs: {
    projectConfig: boolean;
    accountConfig: boolean;
    fileEdit: boolean;
    transfer: boolean;
    previewConfig: boolean;
  };
  mainPanelTabOrder: Array<'projectConfig' | 'accountConfig' | 'fileEdit' | 'transfer' | 'previewConfig'>;
  isJobTabCleared: boolean;
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
}

export interface GitStatus {
  hasGit: boolean;
  hasCodebase: boolean;
  hasFeatures: boolean;
  currentBranch?: string;
  remoteUrl?: string;
}

export interface GitState {
  isGitStatusLoading: boolean;
  gitStatusPhase: 'switching' | 'fetching' | 'pushing' | 'pulling' | 'committing' | 'syncing' | 'initializing' | 'cloning' | 'discarding' | null;
  gitStatus: GitStatus | null;  // ✅ Single source of truth for Git state
  gitStatusRefreshTrigger: number;
  bypassFetchTimer: boolean;  // ✅ Flag to bypass timer for next fetch
}

export interface PreviewSliceState {
  previewStatus: PreviewStatus | undefined;
  isPreviewLoading: boolean;
}

export interface AuthState {
  userEmail: string | undefined;
  userOrganization: string | undefined;
  selectedAgent: string;
  selectedJobType: 'design' | 'code' | 'learn' | 'plan';
}

export interface ConfigState {
  recursionLimit: number;
  backendMode: 'local' | 'cloud';
  localBackendPort: number;  // 로컬 백엔드 포트 (default: 4100)
}

// ==================
// Combined State
// ==================

export type StoreState = ProjectState & 
  FileState & 
  JobState & 
  SSEState & 
  UIState & 
  GitState & 
  PreviewSliceState & 
  AuthState & 
  ConfigState;


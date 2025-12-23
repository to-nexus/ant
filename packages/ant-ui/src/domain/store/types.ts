import { Session } from '@/domain/models/session';
import { Feature, FileNode, FileContent, DevServerStatus, KanbanData } from '@/infrastructure/http/api';
import { JobExecution } from '@/infrastructure/http/cli';
import type { ChatMessage } from '@/domain/models/chat';

// ==================
// Store State Types
// ==================

export interface ProjectState {
  projects: string[];
  selectedProject: string | undefined;
  selectedFeature: string | undefined;
  features: Feature[];
}

export interface FileState {
  selectedFile: string | undefined;
  fileTree: FileNode[];
  fileContent: FileContent | undefined;
}

export interface JobState {
  session: Session | undefined;
  isRunning: boolean;
  isStopping: boolean;
  userStoppedJobId: string | null;
  lastJobFailed: boolean;
  dismissedInterruptTimestamp: string | null;
  runningJobsByFeature: Record<string, string>;
  currentJobId: string | undefined;
  currentJob: JobExecution | null;
  taskStartTime: number | undefined;
  elapsedTime: number;
  currentMode: 'generate' | 'refactor' | 'explain' | undefined;
}

export interface SSEState {
  kanban: KanbanData;
  chatMessages: ChatMessage[];
  connectionStatus: 'connected' | 'disconnected' | 'error';
}

export interface UIState {
  theme: 'light' | 'dark';
  splitLayout: 'horizontal' | 'vertical';
  mainView: 'agents' | 'codeIde';
  ideWorkspacePath: string | undefined;
  ideReloadTimestamp: number; // ✅ Add timestamp to force IDE reload
  mainPanelActiveTab: 'job' | 'projectConfig' | 'accountConfig' | 'fileEdit';
  mainPanelOpenTabs: {
    projectConfig: boolean;
    accountConfig: boolean;
    fileEdit: boolean;
  };
  mainPanelTabOrder: Array<'projectConfig' | 'accountConfig' | 'fileEdit'>;
  isJobTabCleared: boolean;
}

export interface GitState {
  isGitStatusLoading: boolean;
  gitStatusPhase: 'switching' | 'fetching' | 'pushing' | 'pulling' | 'committing' | 'syncing' | 'initializing' | 'cloning' | null;
  currentGitBranch: string | undefined;
  gitStatusRefreshTrigger: number;
}

export interface DevServerState {
  devServerStatus: DevServerStatus | undefined;
  isDevServerLoading: boolean;
}

export interface AuthState {
  userEmail: string | undefined;
  userOrganization: string | undefined;
  selectedAgent: string;
  selectedJobType: 'design' | 'code' | 'learn';
}

export interface ConfigState {
  recursionLimit: number;
  frontendMode: 'cloud' | 'local';
  backendMode: 'local' | 'cloud';
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
  DevServerState & 
  AuthState & 
  ConfigState;


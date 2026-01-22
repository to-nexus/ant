import { ChildProcess } from 'child_process';
import { Response } from 'express';
import { JobStatus, LogEntry } from '../../../../../core/ports';
import { UserContext } from '../../../../../core/types/user';

/**
 * Job-to-project mapping for Kanban tracking
 */
export interface JobProjectMapping {
  projectId: string;
  featureName: string;
  jobType: 'design' | 'code' | 'learn';
  userContext?: UserContext;
}

/**
 * Task queue snapshot for real-time Kanban updates
 */
export interface TaskQueueSnapshot {
  currentTask: any;
  queue: any[];
  completedTasks: any[];
  recursionCount?: number;
  recursionLimit?: number;
}

/**
 * In-memory state for job execution tracking
 */
export interface JobExecutionState {
  jobs: Map<string, JobStatus>;
  logs: Map<string, LogEntry[]>;
  logStreams: Map<string, Set<(log: LogEntry) => void>>;
  sseResponses: Map<string, Set<Response>>;
  childProcesses: Map<string, ChildProcess>;
  currentJobId: string | null;
  taskQueueSnapshots: Map<string, TaskQueueSnapshot>;
  jobToProject: Map<string, JobProjectMapping>;
  userStoppedJobs: Set<string>;
}

/**
 * Server configuration
 */
export interface ServerConfig {
  mode: 'local' | 'cloud';
  workspacesPath: string;
  cloudUrl: string;
}

/**
 * Shared services and dependencies
 */
export interface ServerDependencies {
  workspaceService: any;
  workspaceResolver: any;
  authService?: any;
  oidcService?: any;
  portManager: any;
  portRegistry: any;
  ideService: any;
  kanbanService: any;
  sessionService: any;
  gitWatcherService: any;
  previewService: any;
  projectService: any;
  chatService: any;
  graphMetadataService: any;
  workflowStateService: any;
  sseService: any;
  githubAuthService: any;
  jobPrerequisitesAdapter: any;
}

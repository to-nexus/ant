import { ChildProcess } from 'child_process';
import { Response } from 'express';
import { JobStatus, LogEntry } from '../../../../../core/ports';
import type { TaskQueueSnapshot, JobProjectMapping } from '../../../../../core/types/task';

// Re-export for consumers within periphery
export type { TaskQueueSnapshot, JobProjectMapping };

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
 * 
 * Note: previewService moved to ant-preview (see 10-cloud-architecture.md)
 */
export interface ServerDependencies {
  workspaceService: any;
  workspaceResolver: any;
  authService?: any;
  oidcService?: any;
  jwtService?: any;
  portManager: any;
  portRegistry: any;
  ideService: any;
  kanbanService: any;
  sessionService: any;
  gitWatcherService: any;
  projectService: any;
  chatService: any;
  graphMetadataService: any;
  workflowStateService: any;
  githubAuthService: any;
  jobPrerequisitesAdapter: any;
  transferService?: any;
}

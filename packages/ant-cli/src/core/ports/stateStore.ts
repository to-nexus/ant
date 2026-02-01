/**
 * StateStorePort
 * 
 * Unified interface for state storage in ant-cli.
 * Combines Job State, Port Registry, and Pub/Sub capabilities.
 * 
 * Implementations:
 * - InMemoryStateStore: For local/single-server mode
 * - RedisStateStore: For cloud/distributed mode (Phase 2)
 * 
 * @see 10-cloud-scalability-design.md Section 4.1
 */

import { UserContext } from '../types/user';

// Re-export LogEntry from http.ts to avoid duplication
export { LogEntry } from './http';
import { LogEntry } from './http';

// ============================================
// Job Status Types
// ============================================

export type JobStatusValue = 'pending' | 'queued' | 'running' | 'completed' | 'failed' | 'paused';

export interface JobStatusData {
  jobId: string;
  status: JobStatusValue;
  projectId: string;
  featureName: string;
  type: 'code' | 'design' | 'learn';   // Job type
  mode?: 'generate' | 'refactor' | 'explain';  // Job mode
  timestamp?: string;  // When the status was set
  
  // Backward compatibility alias
  /** @deprecated Use type instead */
  jobType?: 'code' | 'design' | 'learn';
  userContext?: UserContext;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  task?: string;
}

export interface TaskQueueSnapshot {
  currentTask: any;
  queue: any[];
  completedTasks: any[];
  recursionCount: number;
  recursionLimit: number;
}

export interface JobProjectMapping {
  projectId: string;
  featureName: string;
  jobType: 'code' | 'design' | 'learn';
  userContext?: UserContext;
}

// ============================================
// Chat Session Types (for Cloud Mode)
// ============================================

export interface ChatMessageContent {
  type: string;
  content: string;
  metadata?: Record<string, any>;
}

export interface ChatMessageData {
  id: string;
  role: 'user' | 'assistant';
  contents: ChatMessageContent[];
  timestamp: string;
  jobId?: string;
  isStreaming?: boolean;
}

export interface ChatSessionData {
  projectId: string;
  featureName: string;
  jobId?: string;
  messages: ChatMessageData[];
  userContext?: UserContext;
  // Streaming state
  thinkingStartTime?: number;
  lastThinkingContentIndex?: number;
  activeFileOperations?: Array<{ filePath: string; contentIndex: number }>;
}

// ============================================
// Port Registry Types (from existing portRegistry.ts)
// ============================================

export interface PortMapping {
  tenantId: string;
  userId: string;
  projectId: string;
  feature: string;
  port: number;
  host?: string;  // For remote workers (Phase 3)
  registeredAt: Date;
  lastAccessedAt: Date;
}

// ============================================
// StateStorePort Interface
// ============================================

export interface StateStorePort {
  // ============================================
  // Job Status Management
  // ============================================
  
  /**
   * Set job status
   */
  setJobStatus(jobId: string, status: JobStatusData): Promise<void>;
  
  /**
   * Get job status
   */
  getJobStatus(jobId: string): Promise<JobStatusData | null>;
  
  /**
   * Update partial job status
   */
  updateJobStatus(jobId: string, updates: Partial<JobStatusData>): Promise<void>;
  
  /**
   * Delete job status
   */
  deleteJobStatus(jobId: string): Promise<void>;
  
  /**
   * List jobs by project and feature
   */
  listJobsByFeature(projectId: string, featureName: string): Promise<JobStatusData[]>;
  
  // ============================================
  // Job Logs Management
  // ============================================
  
  /**
   * Append log entry to job
   */
  appendJobLog(jobId: string, log: LogEntry): Promise<void>;
  
  /**
   * Get all logs for a job
   */
  getJobLogs(jobId: string): Promise<LogEntry[]>;
  
  /**
   * Clear logs for a job
   */
  clearJobLogs(jobId: string): Promise<void>;
  
  // ============================================
  // Task Queue Snapshot Management
  // ============================================
  
  /**
   * Update task queue snapshot
   */
  updateTaskQueue(jobId: string, snapshot: TaskQueueSnapshot): Promise<void>;
  
  /**
   * Get task queue snapshot
   */
  getTaskQueue(jobId: string): Promise<TaskQueueSnapshot | null>;
  
  /**
   * Delete task queue snapshot
   */
  deleteTaskQueue(jobId: string): Promise<void>;
  
  // ============================================
  // Job-Project Mapping
  // ============================================
  
  /**
   * Set job-project mapping
   */
  setJobMapping(jobId: string, mapping: JobProjectMapping): Promise<void>;
  
  /**
   * Get job-project mapping
   */
  getJobMapping(jobId: string): Promise<JobProjectMapping | null>;
  
  /**
   * Delete job-project mapping
   */
  deleteJobMapping(jobId: string): Promise<void>;
  
  // ============================================
  // User-Stopped Jobs Tracking
  // ============================================
  
  /**
   * Mark job as user-stopped
   */
  markUserStopped(jobId: string): Promise<void>;
  
  /**
   * Check if job was user-stopped
   */
  isUserStopped(jobId: string): Promise<boolean>;
  
  /**
   * Clear user-stopped flag
   */
  clearUserStopped(jobId: string): Promise<void>;
  
  // ============================================
  // Port Registry - Preview
  // ============================================
  
  /**
   * Register preview port mapping
   */
  registerPreview(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string,
    port: number,
    host?: string
  ): Promise<void>;
  
  /**
   * Get preview port mapping
   */
  getPreview(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string
  ): Promise<PortMapping | null>;
  
  /**
   * Unregister preview
   */
  unregisterPreview(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string
  ): Promise<void>;
  
  /**
   * List all active previews
   */
  listPreviews(): Promise<PortMapping[]>;
  
  // ============================================
  // Port Registry - IDE
  // ============================================
  
  /**
   * Register IDE port mapping
   */
  registerIDE(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string,
    port: number,
    host?: string
  ): Promise<void>;
  
  /**
   * Get IDE port mapping
   */
  getIDE(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string
  ): Promise<PortMapping | null>;
  
  /**
   * Unregister IDE
   */
  unregisterIDE(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string
  ): Promise<void>;
  
  /**
   * List all active IDEs
   */
  listIDEs(): Promise<PortMapping[]>;
  
  /**
   * Update last access time for port mapping
   */
  updateLastAccess(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string,
    type: 'preview' | 'ide'
  ): Promise<void>;
  
  // ============================================
  // Chat Session Management (for Cloud Mode)
  // ============================================
  
  /**
   * Get chat session
   * @param sessionKey - Format: "org:user:projectId/featureName"
   */
  getChatSession(sessionKey: string): Promise<ChatSessionData | null>;
  
  /**
   * Set chat session
   */
  setChatSession(sessionKey: string, session: ChatSessionData): Promise<void>;
  
  /**
   * Delete chat session
   */
  deleteChatSession(sessionKey: string): Promise<void>;
  
  /**
   * Get current streaming message for a session
   */
  getCurrentMessage(sessionKey: string): Promise<ChatMessageData | null>;
  
  /**
   * Set current streaming message for a session
   */
  setCurrentMessage(sessionKey: string, message: ChatMessageData | null): Promise<void>;
  
  /**
   * Check if session has active (streaming) message
   */
  hasActiveMessage(sessionKey: string): Promise<boolean>;
  
  // ============================================
  // Pub/Sub (for Cloud Mode real-time updates)
  // ============================================
  
  /**
   * Publish message to channel
   */
  publish(channel: string, message: any): Promise<void>;
  
  /**
   * Subscribe to channel
   * @returns Unsubscribe function
   */
  subscribe(channel: string, callback: (message: any) => void): Promise<() => void>;
  
  // ============================================
  // Lifecycle
  // ============================================
  
  /**
   * Close connections and cleanup resources
   */
  close(): Promise<void>;
  
  /**
   * Clear all data (for testing)
   */
  clear(): Promise<void>;
}

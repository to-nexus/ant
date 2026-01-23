/**
 * PreviewOrchestratorPort
 * 
 * Interface for managing preview (dev server) instances.
 * Abstracts the underlying infrastructure (local spawn, remote workers).
 * 
 * Implementations:
 * - LocalPreviewOrchestrator: Wraps existing PreviewService (local spawn)
 * - RemotePreviewOrchestrator: Manages remote preview workers (Phase 3)
 * 
 * @see 10-cloud-scalability-design.md Section 3.2.3
 */

import { UserContext } from '../types/user';

// ============================================
// Preview Parameters
// ============================================

export interface PreviewParams {
  tenantId: string;
  userId: string;
  projectId: string;
  feature: string;
  workspacePath: string;
  userContext?: UserContext;
  
  // Optional configuration
  port?: number;  // Preferred port (may be overridden)
}

// ============================================
// Preview Instance Types
// ============================================

export type PreviewStatus = 'starting' | 'running' | 'stopped' | 'error';

export interface PackageInfo {
  name: string;
  path?: string;
  type: 'frontend' | 'backend' | 'fullstack' | 'unknown' | 'other';
  port?: number;
  ready?: boolean;
}

export interface PreviewInstance {
  instanceId: string;  // serverKey: tenantId:userId:projectId:feature
  host: string;        // 'localhost' for local, remote host for cloud
  port: number;
  status: PreviewStatus;
  
  // Additional info
  url?: string;                 // Full proxy URL (e.g., /preview/{serverKey})
  packages?: PackageInfo[];     // Detected packages (monorepo support)
  backendPort?: number;         // For fullstack projects
  processCount?: number;        // Number of running processes
  
  // Metadata
  startedAt?: string;
  lastAccessedAt?: string;
}

// ============================================
// Preview Issues/Errors
// ============================================

export interface PreviewIssue {
  reasoning: string;
  severity: 'fatal' | 'warning';
  reason: string;
  suggestedFix?: string;
}

export interface PreviewStartResult {
  success: boolean;
  instance?: PreviewInstance;
  
  // Error info
  error?: string;
  setupReasoning?: string;
  setupReason?: string;
  suggestedFix?: string;
  issues?: PreviewIssue[];
}

// ============================================
// Log Types
// ============================================

export interface PreviewLogEntry {
  type: 'stdout' | 'stderr' | 'info' | 'error';
  message: string;
  timestamp: string;
  packageName?: string;
}

// ============================================
// PreviewOrchestratorPort Interface
// ============================================

export interface PreviewOrchestratorPort {
  /**
   * Start a preview instance
   */
  start(params: PreviewParams): Promise<PreviewStartResult>;
  
  /**
   * Stop a preview instance
   */
  stop(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string
  ): Promise<{ success: boolean; message?: string }>;
  
  /**
   * Get preview instance status
   */
  getStatus(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string
  ): PreviewInstance | null;
  
  /**
   * Get logs for a preview instance
   */
  getLogs(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string
  ): PreviewLogEntry[];
  
  /**
   * Stream logs in real-time
   * @param callback Called for each new log entry
   * @returns Unsubscribe function
   */
  streamLogs(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string,
    callback: (log: PreviewLogEntry) => void
  ): () => void;
  
  /**
   * Validate preview setup (check for issues before starting)
   */
  validateSetup(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string,
    workspacePath: string
  ): Promise<{
    isValid: boolean;
    issues?: PreviewIssue[];
  }>;
  
  /**
   * List all active preview instances
   */
  listInstances(): Promise<PreviewInstance[]>;
  
  /**
   * Cleanup all instances (for shutdown)
   */
  cleanup(): Promise<void>;
}

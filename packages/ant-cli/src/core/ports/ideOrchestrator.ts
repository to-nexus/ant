/**
 * IDEOrchestratorPort
 * 
 * Interface for managing IDE instances.
 * Abstracts the underlying infrastructure (Docker, Kubernetes).
 * 
 * Implementations:
 * - LocalIDEOrchestrator: Wraps existing IDEService (local Docker)
 * - KubernetesIDEOrchestrator: Manages K8s pods (Phase 4)
 * 
 * @see 10-cloud-scalability-design.md Section 3.2.4
 */

import { UserContext } from '../types/user';

// ============================================
// IDE Parameters
// ============================================

export interface IDEParams {
  tenantId: string;
  userId: string;
  projectId: string;
  feature?: string;  // Default: 'main'
  workspacePath: string;
  userContext: UserContext;
}

// ============================================
// IDE Instance Types
// ============================================

export type IDEStatus = 'starting' | 'running' | 'stopped' | 'error';

export interface IDEInstance {
  instanceId: string;     // Container ID or Pod name
  host: string;           // 'localhost' for Docker, Pod IP for K8s
  port: number;
  url: string;            // Full proxy URL (e.g., /ide/{serverKey})
  workspacePath: string;  // Path inside the container
  status: IDEStatus;
  
  // Context
  tenantId: string;
  userId?: string;
  projectId: string;
  feature?: string;
  
  // Metadata
  createdAt?: Date;
  lastAccessedAt?: Date;
}

// ============================================
// IDE Start Result
// ============================================

export interface IDEStartResult {
  success: boolean;
  instance?: IDEInstance;
  error?: string;
  message?: string;
}

// ============================================
// IDEOrchestratorPort Interface
// ============================================

export interface IDEOrchestratorPort {
  /**
   * Start an IDE instance for a user/project
   */
  start(params: IDEParams): Promise<IDEStartResult>;
  
  /**
   * Stop an IDE instance
   */
  stop(
    tenantId: string,
    projectId: string,
    feature?: string
  ): Promise<{ success: boolean; message?: string }>;
  
  /**
   * Get IDE instance status
   */
  getStatus(
    tenantId: string,
    projectId: string,
    feature?: string
  ): Promise<IDEInstance | null>;
  
  /**
   * List all IDE instances
   */
  list(): Promise<IDEInstance[]>;
  
  /**
   * List IDE instances for a specific user
   */
  listByUser(userContext: UserContext): Promise<IDEInstance[]>;
  
  /**
   * Cleanup all IDE instances for a project
   */
  cleanupProject(
    userContext: UserContext,
    projectId: string,
    options?: { deleteHome?: boolean }
  ): Promise<void>;
  
  /**
   * Cleanup all IDE instances (for shutdown)
   */
  cleanup(): Promise<void>;
  
  /**
   * Start idle check timer
   */
  startIdleCheck(): void;
  
  /**
   * Stop idle check timer
   */
  stopIdleCheck(): void;
}

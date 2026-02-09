/**
 * PortRegistryPort
 * 
 * Interface for managing Preview and IDE state in Redis.
 * All state is stored in Redis for multi-pod consistency.
 */

// ============================================
// Preview Types
// ============================================

export interface PreviewPackage {
  name: string;
  type: 'frontend' | 'backend' | 'other';
  port: number;
}

export interface PreviewRuntimeIssue {
  type: 'error' | 'warning';
  message: string;
  source?: string;
}

export type PreviewPhase = 'idle' | 'installing' | 'starting' | 'running' | 'error' | 'stopped';

export interface PreviewState {
  // Identity
  tenantId: string;
  userId: string;
  projectId: string;
  feature: string;
  
  // Runtime
  running: boolean;
  ready: boolean;
  port: number;                    // Entry port (frontend)
  backendPort?: number;            // Backend port if fullstack
  host: string;                    // Pod IP or localhost
  podId: string;                   // Pod hostname (for identification)
  
  // Phase (single source of truth for UI state)
  phase: PreviewPhase;
  error?: string;                  // Error message when phase is 'error'
  
  // Framework hints (for proxy routing)
  nativeBasePath?: boolean;        // true if framework uses native basePath (e.g. Next.js with basePath config)
  
  // Packages
  packages: PreviewPackage[];
  
  // Issues
  issues: PreviewRuntimeIssue[];
  
  // Timestamps
  startedAt: Date;
  lastAccessedAt: Date;
}

// ============================================
// IDE Types
// ============================================

export interface IDEState {
  // Identity (IDE is project-level, no feature)
  tenantId: string;
  userId: string;
  projectId: string;
  
  // Runtime
  running: boolean;
  ready: boolean;
  port: number;
  host: string;                    // Pod IP
  podId: string;                   // K8s Pod name
  
  // Timestamps
  startedAt: Date;
  lastAccessedAt: Date;
}

// ============================================
// Legacy PortMapping (for backward compatibility during migration)
// ============================================

export interface PortMapping {
  tenantId: string;
  userId: string;
  projectId: string;
  feature: string;
  port: number;
  host?: string;
  registeredAt: Date;
  lastAccessedAt: Date;
}

// ============================================
// Port Registry Interface
// ============================================

export interface PortRegistryPort {
  // ==========================================
  // Preview Management
  // ==========================================
  
  /**
   * Register/Update preview state (full state)
   */
  registerPreview(state: Omit<PreviewState, 'lastAccessedAt'>): Promise<void>;
  
  /**
   * Get preview state
   */
  getPreview(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string
  ): Promise<PreviewState | null>;
  
  /**
   * Get preview port (convenience method)
   */
  getPreviewPort(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string
  ): Promise<number | null>;
  
  /**
   * Update preview state (partial update)
   */
  updatePreview(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string,
    update: Partial<Pick<PreviewState, 'running' | 'ready' | 'phase' | 'error' | 'issues' | 'packages' | 'backendPort' | 'nativeBasePath'>>
  ): Promise<void>;
  
  /**
   * Update last accessed time (called on proxy request)
   */
  touchPreview(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string
  ): Promise<void>;
  
  /**
   * Unregister preview (delete state)
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
  listPreviews(): Promise<PreviewState[]>;
  
  /**
   * List previews for a specific pod (for cleanup on pod restart)
   */
  listPreviewsByPod(podId: string): Promise<PreviewState[]>;
  
  /**
   * Get idle previews (for auto-cleanup)
   * @param idleThresholdMs - Milliseconds since last access
   */
  getIdlePreviews(idleThresholdMs: number): Promise<PreviewState[]>;
  
  // ==========================================
  // IDE Management
  // ==========================================
  
  /**
   * Register IDE state
   */
  registerIDE(
    tenantId: string,
    userId: string,
    projectId: string,
    port: number,
    host: string,
    podId: string
  ): Promise<void>;
  
  /**
   * Get IDE state
   */
  getIDE(
    tenantId: string,
    userId: string,
    projectId: string
  ): Promise<IDEState | null>;
  
  /**
   * Get IDE port (convenience method)
   */
  getIDEPort(
    tenantId: string,
    userId: string,
    projectId: string
  ): Promise<number | null>;
  
  /**
   * Update last accessed time
   */
  touchIDE(
    tenantId: string,
    userId: string,
    projectId: string
  ): Promise<void>;
  
  /**
   * Unregister IDE
   */
  unregisterIDE(
    tenantId: string,
    userId: string,
    projectId: string
  ): Promise<void>;
  
  /**
   * List all active IDEs
   */
  listIDEs(): Promise<IDEState[]>;
  
  // ==========================================
  // Lifecycle
  // ==========================================
  
  /**
   * Cleanup (close connections, etc.)
   */
  close(): Promise<void>;
}

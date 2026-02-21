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

export type PreviewStructureType = 'frontend-only' | 'backend-only' | 'fullstack' | 'monorepo';

// === External Service Contract ===

/**
 * Service category.
 *   business:        Frontend / backend / MSA business services
 *   infrastructure:  DB, Redis, MQ, etc. — provided via docker-compose in dev
 */
export type ServiceCategory = 'business' | 'infrastructure';

/**
 * How a connection is resolved (independent of category).
 *   docker:       Service inside project's docker-compose (auto-detected)
 *   ant-project:  Another Ant project or same-project internal (proxy routing auto-configured)
 *   url:          Direct URL (user-provided or computed)
 * 
 * Resolution type constraints (enforced at API layer):
 *   infrastructure → url | docker       (DB/cache/MQ are never Ant projects)
 *   business       → url | ant-project  (business services are never docker-compose)
 * 
 * For same-project internal connections, ant-project uses projectId/feature of the current project.
 * The `self` keyword in @connection annotations triggers this at detection time.
 */
export type ConnectionResolution =
  | { type: 'docker'; service: string; port?: number }
  | { type: 'ant-project'; projectId: string; feature: string; resolvedUrlKey?: string }
  | { type: 'url'; url: string };

/**
 * A single service connection entry.
 * Replaces the old LinkedBackendConfig with a generic model
 * that covers FE->BE, BE->BE, service->infra connections.
 */
export interface ServiceConnection {
  id: string;                         // Unique key ("postgres", "redis", "backend-api")
  name: string;                       // Display name ("PostgreSQL", "Backend API")
  category: ServiceCategory;          // business | infrastructure
  envVar: string;                     // Environment variable name ("DATABASE_URL")
  value: string;                      // Resolved value ("postgres://user:pw@localhost:5432/db")
  resolution: ConnectionResolution;   // How the connection is resolved
  source?: string;                    // Package requiring this ("backend", "frontend", "*")
  status?: 'active' | 'unreachable' | 'not-started';
  missingAnnotation?: boolean;        // Detected via fallback = .env.example lacks @connection
}

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
  
  // Project structure (auto-detected at preview start)
  structureType?: PreviewStructureType;
  
  // Project profile (language/framework, detected by decompose node)
  projectProfile?: { language: string; framework?: string };
  
  // Service connections (auto-detected + user-configured via Preview Config UI)
  connections: ServiceConnection[];
  
  // nativeBasePath removed — all frameworks now use native base path via env var injection.
  // Kept as optional field for backward compat with existing Redis entries during rollout.
  nativeBasePath?: boolean;
  
  // Packages
  packages: PreviewPackage[];
  
  // Issues
  issues: PreviewRuntimeIssue[];
  
  // Validation failure info (persisted for polling consistency)
  setupReasoning?: string;
  setupReason?: string;
  suggestedFix?: string;
  
  // Timestamps
  startedAt: Date;
  lastAccessedAt: Date;
}

// ============================================
// IDE Types
// ============================================

export interface IDEState {
  // Identity (IDE is feature-level: org:user:project:feature)
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
// Port Mapping
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
    update: Partial<Pick<PreviewState, 'running' | 'ready' | 'phase' | 'error' | 'issues' | 'packages' | 'backendPort' | 'nativeBasePath' | 'structureType' | 'projectProfile' | 'setupReasoning' | 'setupReason' | 'suggestedFix' | 'connections'>>
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
    podId: string,
    feature?: string
  ): Promise<void>;
  
  /**
   * Get IDE state
   */
  getIDE(
    tenantId: string,
    userId: string,
    projectId: string,
    feature?: string
  ): Promise<IDEState | null>;
  
  /**
   * Get IDE port (convenience method)
   */
  getIDEPort(
    tenantId: string,
    userId: string,
    projectId: string,
    feature?: string
  ): Promise<number | null>;
  
  /**
   * Update last accessed time
   */
  touchIDE(
    tenantId: string,
    userId: string,
    projectId: string,
    feature?: string
  ): Promise<void>;
  
  /**
   * Unregister IDE
   */
  unregisterIDE(
    tenantId: string,
    userId: string,
    projectId: string,
    feature?: string
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

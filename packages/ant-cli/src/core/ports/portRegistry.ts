/**
 * PortRegistryPort
 * 
 * Interface for managing Preview and IDE state in Redis.
 * All state is stored in Redis for multi-pod consistency.
 */

import type { PreviewStructureType } from './preview';

// ============================================
// Preview Types
// ============================================

export interface PreviewPackage {
  name: string;
  /**
   * URL-safe identifier derived from `name` via `packageSlug()`.
   * Used as the 5th segment of the urlKey for multi-frontend setups so each
   * frontend can be addressed at a unique URL.
   *
   * Always set on entries written by code that has been upgraded to support
   * multi-frontend; missing on stale entries written by older builds (in
   * which case routing falls back to the entry frontend).
   *
   * SSOT: derivation lives in
   * `periphery/adapters/http/services/PreviewService/utils/serverKeyUtils.ts#packageSlug`.
   */
  slug?: string;
  type: 'frontend' | 'backend' | 'other';
  port: number;
  /**
   * Per-package urlKey. For single-frontend setups this equals the 4-part
   * `toUrlKey(serverKey)` (back-compat). For multi-frontend setups this is
   * the 5-part `toUrlKeyWithService(serverKey, slug)`. Set only for
   * frontend packages; backend / other packages have no basePath and so no
   * urlKey to expose.
   */
  urlKey?: string;

  // ── ANT-owned process identity (cleanup-by-identity SSOT) ──
  // Persisted at spawn time so cleanup targets ONLY processes this pod
  // provably spawned, scoped to `(podId, serverKey)`. Replaces the old
  // OS port/cwd scan whose bare port number was treated as a global
  // process identity when it was only pod-local — the cross-project kill
  // root cause. All optional for read-tolerance: stale entries written by
  // older builds simply lack them (a redeploy restarts every ant-preview
  // pod, so no live preview carries an old-schema record across the cutover).
  /** Leader PID of the spawned dev-server group. */
  pid?: number;
  /**
   * Process-group id. Equals `pid` by the `detached:true` spawn contract
   * (ProcessSpawner) — persisted explicitly so cleanup can `kill(-pgid)`
   * the whole group even after the leader shell has exited (the re-parented
   * dev server still holds the port within the same group).
   */
  pgid?: number;
  /** Hostname of the pod that spawned this process (`os.hostname()`). */
  podId?: string;
  /** Spawn timestamp (ms epoch) for diagnostics / PID-reuse reasoning. */
  spawnedAt?: number;
}

export interface PreviewRuntimeIssue {
  type: 'error' | 'warning';
  message: string;
  source?: string;
}

export type PreviewPhase = 'idle' | 'installing' | 'infra' | 'provisioning' | 'starting' | 'running' | 'error' | 'stopped';

/**
 * Which startup stage an `error` phase failed in. Lets the UI show "infra
 * failed" / "migrations failed" instead of a buried log line. `undefined`
 * for non-error phases.
 */
export type PreviewErrorStage = 'install' | 'infra' | 'provisioning' | 'starting';

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
  | { type: 'ant-project'; projectId: string; feature: string; serviceName?: string; resolvedUrlKey?: string }
  | { type: 'url'; url: string };

/**
 * Service Virtualization strategy attached to every `business` connection
 * by definition. The `business` category itself is the virtualization
 * signal — there is no separate annotation token (a single-valued
 * discriminator carries no information).
 *
 * `infrastructure` connections do NOT receive this field: docker-compose
 * provides the real backing service, virtualization is not the concern.
 *
 * SSOT for the umbrella concept ("Service Virtualization") and the leaf
 * vocabulary ("mock") split — see `mock_real_symmetry_ssot` plan §0.
 */
export interface VirtualizationStrategy {
  /**
   * Per-connection toggle env var name, derived from the connection name
   * (uppercase snake of `name`, e.g. `stripe-api` → `USE_MOCK_STRIPE_API`).
   * Always present — every business connection is virtualizable.
   */
  toggleEnvVar: string;
  /**
   * Effective toggle state at detection time, resolved against the project
   * `.env` using priority `USE_MOCK_<NAME>` > master `USE_MOCK` > `false`.
   */
  active: boolean;
}

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
  status?: 'active' | 'starting' | 'stopped' | 'error';
  missingAnnotation?: boolean;        // Detected via fallback = .env.example lacks @connection
  configSource?: 'env' | 'toml';     // Which config file format this was detected from
  /**
   * Service Virtualization strategy. Auto-attached for every
   * `category === 'business'` connection (every external dependency is
   * virtualizable by definition). `undefined` for `infrastructure`
   * connections — docker-compose provides the real backing service.
   */
  virtualization?: VirtualizationStrategy;
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
  errorStage?: PreviewErrorStage;  // Which startup stage failed (when phase === 'error')
  hint?: string;                   // Actionable next-step hint for the failed stage
  
  // Project structure (auto-detected at preview start)
  structureType?: PreviewStructureType;
  
  // Project profile (language/framework, detected by decompose node)
  projectProfile?: { language: string; framework?: string };
  
  // Service connections (auto-detected + user-configured via Preview Config UI)
  connections: ServiceConnection[];

  // True when a saved connection/toggle change has NOT yet been applied to the
  // running dev server (env is captured at spawn time; applying = restart).
  // Set by toggle/preview-config save while running; cleared on startPreview.
  restartRequired?: boolean;

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
// Deploy Types (SSOT: @ant/shared)
// ============================================

export type { DeployPhase, DeployFramework, DeployVisibility } from '@ant/shared';
import type { DeployPhase, DeployFramework, DeployVisibility } from '@ant/shared';

/**
 * One deployed frontend package.
 *
 * Multi-frontend monorepos produce N entries (one per frontend); single-frontend
 * projects produce a single-element array. The shape is uniform — there is no
 * "primary" entry that gets special treatment elsewhere in the code.
 */
export interface DeployPackage {
  /** Original package name (e.g. "apps/web", "root"). UI display value. */
  name: string;
  /**
   * URL-safe identifier (`packageSlug(name)`, deduped within a project).
   * Used as the 5th urlKey segment for multi-frontend setups.
   */
  slug: string;
  framework: DeployFramework;
  /**
   * Absolute path to THIS package's directory.
   * Used as `cwd` for `next start` and as the build root for `runBuild`.
   * For single-frontend projects this equals `DeployState.workspacePath`.
   */
  workspacePath: string;
  /** Per-package build artifact directory. */
  buildOutputDir: string;
  /**
   * Public path prefix this package is served under.
   * Single-frontend: `/deploy/{4partUrlKey}`.
   * Multi-frontend:  `/deploy/{4partUrlKey}--{slug}`.
   */
  basePath: string;
  /** Static-server port allocated for this package. */
  port: number;
  /**
   * The urlKey segment carried in the public URL.
   * 4-part for single-frontend, 5-part for multi-frontend.
   */
  urlKey: string;
  /** Public URL for this package (`/deploy/{urlKey}`). */
  url: string;
  /** Per-package phase. Aggregate `DeployState.phase` is derived from these. */
  phase: DeployPhase;
  /** Last error for THIS package, if any. */
  error?: string;
}

/**
 * Aggregate deploy state for a (tenant, user, project, feature) tuple.
 *
 * Multi-package SSOT: every per-frontend datum lives in `packages[]`.
 * Top-level fields are identity + lifecycle only — no legacy duals.
 */
export interface DeployState {
  // Identity
  tenantId: string;
  userId: string;
  projectId: string;
  feature: string;

  // Aggregate lifecycle
  /**
   * Aggregated across `packages[]`:
   *   error       if any package errored
   *   building    if any package is building
   *   deploying   if any deploying & none building/error
   *   running     when every package is running
   *   stopped/hibernated/unavailable propagate from registry-level transitions.
   */
  phase: DeployPhase;
  host: string;
  podId: string;

  /** Sibling deploy/ workspace root (shared by all packages). */
  workspacePath: string;

  /** One entry per built frontend. Always non-empty after `startDeploy`. */
  packages: DeployPackage[];

  /**
   * Access visibility (default `'public'`). `'private'` gates the deploy
   * proxy: only the owning tenant/user may access, else an indistinguishable
   * 404. Persisted in `.deploy/meta.json` so it survives rehydration.
   */
  visibility: DeployVisibility;

  error?: string;
  buildLog?: string[];

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
    update: Partial<Pick<PreviewState, 'running' | 'ready' | 'phase' | 'error' | 'errorStage' | 'hint' | 'issues' | 'packages' | 'backendPort' | 'nativeBasePath' | 'structureType' | 'projectProfile' | 'setupReasoning' | 'setupReason' | 'suggestedFix' | 'connections' | 'restartRequired'>>
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

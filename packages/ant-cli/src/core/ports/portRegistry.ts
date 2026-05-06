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
}

export interface PreviewRuntimeIssue {
  type: 'error' | 'warning';
  message: string;
  source?: string;
}

export type PreviewPhase = 'idle' | 'installing' | 'starting' | 'running' | 'error' | 'stopped';

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
 * Service Virtualization strategy attached to a connection when its
 * `@connection` annotation declares a `mock:available` or `mock:inline`
 * modifier. Records how the project intends to swap a virtualized adapter
 * in for the production adapter at runtime.
 *
 * SSOT for the umbrella concept ("Service Virtualization") and the leaf
 * vocabulary ("mock") split — see `mock_real_symmetry_ssot` plan §0.
 */
export interface VirtualizationStrategy {
  /**
   * `'available'` — code provides BOTH production and mock adapters; selection
   *   happens at runtime via `USE_MOCK_<NAME>` env var (or master `USE_MOCK`
   *   fallback).
   * `'inline'`    — production adapter contains an internal fallback / fake
   *   when the real endpoint is unavailable. No external toggle.
   */
  mockKind: 'available' | 'inline';
  /**
   * Per-connection toggle env var name, derived from the connection name
   * (uppercase snake of `name`, e.g. `stripe-api` → `USE_MOCK_STRIPE_API`).
   * Set only when `mockKind === 'available'`.
   */
  toggleEnvVar?: string;
  /**
   * Effective toggle state at detection time.
   *   - `mockKind === 'inline'` ⇒ always `true` (the mock is part of the
   *     production adapter; nothing to toggle).
   *   - `mockKind === 'available'` ⇒ resolved against the project `.env`
   *     using priority `USE_MOCK_<NAME>` > master `USE_MOCK` > `false`.
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
   * Service Virtualization strategy. Set only when the `@connection`
   * annotation declares a `mock:available` or `mock:inline` modifier.
   * `undefined` means the connection has no virtualization story
   * (production-only — caller must supply a real endpoint).
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
// Deploy Types (SSOT: @ant/shared)
// ============================================

export type { DeployPhase, DeployFramework } from '@ant/shared';
import type { DeployPhase, DeployFramework } from '@ant/shared';

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

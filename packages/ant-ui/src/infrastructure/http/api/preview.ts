import { PREVIEW_BASE, authFetch, apiGet, apiPost, apiPut } from './client';

export interface LogEntry {
  timestamp: string;
  type: 'stdout' | 'stderr';
  message: string;
}

export type ServiceCategory = 'business' | 'infrastructure';

export type ConnectionResolution =
  | { type: 'docker'; service: string; port?: number }
  | { type: 'ant-project'; projectId: string; feature: string; serviceName?: string; resolvedUrlKey?: string }
  | { type: 'url'; url: string };

export interface ServiceConnection {
  id: string;
  name: string;
  category: ServiceCategory;
  envVar: string;
  value: string;
  resolution: ConnectionResolution;
  source?: string;
  status?: 'active' | 'starting' | 'stopped' | 'error';
  missingAnnotation?: boolean;
  userModified?: boolean;
}

/** One package in the running preview (slug-addressable). */
export interface PreviewStatusPackage {
  name: string;
  /**
   * URL-safe identifier. Optional only for back-compat with old BE builds
   * that didn't emit it; new BE always sets this.
   */
  slug?: string;
  type: 'frontend' | 'backend' | 'other';
  port: number;
  /** urlKey segment carried in this package's public URL. */
  urlKey?: string;
  /**
   * Public URL for this package. Set for openable frontend packages
   * (`/{4partUrlKey}` for single-frontend, `/{5partUrlKey}` for multi).
   * `null` for backend / other packages.
   */
  url?: string | null;
}

export interface PreviewStatus {
  running: boolean;
  ready?: boolean;
  port?: number | null;
  backendPort?: number | null;
  /**
   * Representative Open URL.
   * `null` when there are 2+ frontends — UI must use `packages[].url` to
   * render one Open button per accessible frontend.
   */
  url?: string | null;
  logs?: LogEntry[];
  setupReasoning?: string;
  setupReason?: string;
  suggestedFix?: string;
  packages?: PreviewStatusPackage[];
  issues?: Array<{ reasoning: string; severity: 'fatal' | 'warning'; reason: string; suggestedFix?: string }>;
  phase?: 'idle' | 'installing' | 'starting' | 'running' | 'stopping' | 'stopped' | 'error';
  error?: string;
  structureType?: 'frontend-only' | 'backend-only' | 'fullstack' | 'monorepo' | null;
  projectProfile?: { language: string; framework?: string } | null;
  connections?: ServiceConnection[] | null;
  canStart?: boolean;
}

export interface PreviewConfig {
  structureType?: 'frontend-only' | 'backend-only' | 'fullstack' | 'monorepo' | null;
  projectProfile?: { language: string; framework?: string } | null;
  connections?: ServiceConnection[] | null;
}

/**
 * Start preview. Has custom error properties for frontend Fix button.
 */
export async function startPreview(
  projectId: string,
  feature?: string,
  port?: number,
): Promise<{ success: boolean; message: string; script?: string; status?: any }> {
  const response = await authFetch(
    `${PREVIEW_BASE()}/projects/${encodeURIComponent(projectId)}/start`,
    {
      method: 'POST',
      body: JSON.stringify({ feature: feature || 'main', port }),
    },
  );

  if (!response.ok) {
    const errorData = await response.json();
    const err: any = new Error(
      errorData.error || `Failed to start preview: ${response.statusText}`,
    );
    err.setupReasoning = errorData.setupReasoning;
    err.setupReason = errorData.setupReason;
    err.suggestedFix = errorData.suggestedFix;
    err.issues = errorData.issues;
    throw err;
  }

  return response.json();
}

export function stopPreview(
  projectId: string,
  feature?: string,
): Promise<{ success: boolean; message: string }> {
  return apiPost(
    `${PREVIEW_BASE()}/projects/${encodeURIComponent(projectId)}/stop`,
    { feature: feature || 'main' },
  );
}

export function getPreviewStatus(projectId: string, feature?: string): Promise<PreviewStatus> {
  const featureParam = feature ? `?feature=${encodeURIComponent(feature)}` : '';
  return apiGet(
    `${PREVIEW_BASE()}/projects/${encodeURIComponent(projectId)}/status${featureParam}`,
  );
}

export function getPreviewConfig(projectId: string, feature?: string): Promise<PreviewConfig> {
  const featureParam = feature ? `?feature=${encodeURIComponent(feature)}` : '';
  return apiGet(
    `${PREVIEW_BASE()}/projects/${encodeURIComponent(projectId)}/preview-config${featureParam}`,
  );
}

export function updatePreviewConfig(
  projectId: string,
  feature: string,
  config: { connections?: ServiceConnection[] | null },
): Promise<{ success: boolean; connections?: ServiceConnection[] }> {
  return apiPut(
    `${PREVIEW_BASE()}/projects/${encodeURIComponent(projectId)}/preview-config`,
    { feature: feature || 'main', connections: config.connections },
  );
}

export function detectConnections(
  projectId: string,
  feature?: string,
): Promise<{ success: boolean; connections: ServiceConnection[] }> {
  return apiPost(
    `${PREVIEW_BASE()}/projects/${encodeURIComponent(projectId)}/detect-connections`,
    { feature: feature || 'main' },
  );
}

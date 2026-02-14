/// <reference types="vite/client" />

import type { Session } from '@/domain/models/session';
import type { TaskTiming, KanbanData } from '@ant/shared';

// ============================================================================
// URL Configuration
// ============================================================================
// 
// 백엔드 모드/포트는 사용자 설정(localStorage)에서 읽어옴:
// - backendMode: 'local' | 'cloud' (UI에서 선택)
// - localBackendPort: 4100 등 (UI에서 설정)
//
// URL 결정:
// - local mode → http://localhost:{localBackendPort}
// - cloud mode → VITE_CLOUD_BACKEND_BASE (환경변수, 빌드 시점 고정)
//
// api, realtime, ide는 같은 서버의 Ingress 경로로 라우팅됨
// preview는 별도 호스트 (VITE_PREVIEW_HOST)
// ============================================================================

const DEFAULT_LOCAL_BACKEND_PORT = 4100;
const STORAGE_KEY_BACKEND_MODE = 'ant-ui:backend-mode';
const STORAGE_KEY_LOCAL_BACKEND_PORT = 'ant-ui:local-backend-port';

/**
 * Get current backend mode from localStorage
 * @returns 'local' or 'cloud' (default: 'cloud')
 */
export const getBackendMode = (): 'local' | 'cloud' => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY_BACKEND_MODE);
    if (stored) {
      const parsed = JSON.parse(stored);
      return parsed === 'local' ? 'local' : 'cloud';
    }
  } catch (error) {
    console.warn('[API] Error reading backend mode:', error);
  }
  return 'cloud';  // default
};

/**
 * Get local backend port from localStorage
 * @returns port number (default: 4100)
 */
export const getLocalBackendPort = (): number => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY_LOCAL_BACKEND_PORT);
    if (stored) {
      const parsed = JSON.parse(stored);
      return typeof parsed === 'number' ? parsed : DEFAULT_LOCAL_BACKEND_PORT;
    }
  } catch (error) {
    console.warn('[API] Error reading local backend port:', error);
  }
  return DEFAULT_LOCAL_BACKEND_PORT;
};

/**
 * Get backend base URL based on current mode
 * - local mode (dev): 상대 경로 사용 (Vite 프록시가 각 서비스로 라우팅)
 * - cloud mode: VITE_CLOUD_BACKEND_BASE (환경변수 필수)
 * 
 * ⚠️ Cloud 모드에서는 VITE_CLOUD_BACKEND_BASE가 반드시 설정되어 있어야 함
 * 설정되지 않으면 상대 경로('')를 반환하며, 이 경우 Ingress/ALB가 라우팅해야 함
 * 
 * ✅ Local mode에서 상대 경로를 사용하는 이유:
 * - Vite dev server가 프록시를 통해 각 서비스로 라우팅:
 *   - /api/* → localhost:4100 (API Server)
 *   - /realtime/* → localhost:4101 (Realtime Server - SSE)
 * - preview는 별도 호스트 (VITE_PREVIEW_HOST)로 직접 호출
 * - 직접 http://localhost:4100으로 요청하면 /realtime 라우트가 없어서 SSE 연결 실패
 */
const getBackendBase = (): string => {
  const mode = getBackendMode();
  
  if (mode === 'cloud') {
    const cloudBase = import.meta.env.VITE_CLOUD_BACKEND_BASE;
    if (!cloudBase) {
      // 환경변수 미설정 시 상대 경로 사용 (Ingress/ALB가 라우팅)
      // 이 경우 프론트엔드와 백엔드가 같은 도메인에 있어야 함
      console.warn('[API] VITE_CLOUD_BACKEND_BASE not set, using relative paths');
      return '';
    }
    return cloudBase;
  }
  
  // ✅ Local mode: 상대 경로 사용 (Vite 프록시 활용)
  // Vite dev server의 프록시가 각 서비스로 올바르게 라우팅함
  // @see vite.config.ts - proxy configuration
  return '';
};

/**
 * API Server base URL
 * - /api/* → ant-api service
 */
export const API_BASE = () => `${getBackendBase()}/api`;

/**
 * Realtime (SSE) Server base URL  
 * - /realtime/* → ant-realtime service
 */
export const REALTIME_BASE = () => `${getBackendBase()}/realtime`;

/**
 * Preview Server base URL (별도 호스트)
 * - ant-preview.crosstoken.io (cloud)
 * - localhost:4102 (local)
 */
export const getPreviewBase = (): string => {
  const previewHost = import.meta.env.VITE_PREVIEW_HOST;
  if (previewHost) return previewHost;
  return 'http://localhost:4102'; // fallback
};

export const PREVIEW_BASE = () => getPreviewBase();

/**
 * Server base URL (without path prefix)
 * For endpoints that don't use /api prefix (e.g., /ide/*)
 */
export const SERVER_BASE = () => getBackendBase();

/**
 * Check if backend server is available
 */
export async function checkLocalBackend(): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE()}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(3000)
    });
    return response.ok;
  } catch (error) {
    console.warn('[API] Backend not available');
    return false;
  }
}

if (import.meta.env.DEV) {
  console.log('[API] Backend mode:', getBackendMode());
  console.log('[API] API_BASE:', API_BASE());
  console.log('[API] REALTIME_BASE:', REALTIME_BASE());
  console.log('[API] PREVIEW_BASE:', PREVIEW_BASE());
}

/**
 * Get authentication headers for Cloud mode
 * Automatically adds x-user-email header if user is signed in
 * 
 * ✅ Only adds headers for Cloud mode
 */
function getAuthHeaders(): HeadersInit {
  // ✅ Skip auth headers for Local mode
  const backendMode = getBackendMode();
  
  if (backendMode === 'local') {
    return {};
  }
  
  // Get user email from localStorage (Cloud mode only)
  try {
    const userEmail = localStorage.getItem('ant-ui:user-email');
    
    if (userEmail) {
      const email = JSON.parse(userEmail);
      return {
        'x-user-email': email
      };
    } else {
      console.warn('[getAuthHeaders] ❌ No userEmail in localStorage!');
      console.warn('[getAuthHeaders] localStorage keys:', Object.keys(localStorage));
    }
  } catch (error) {
    console.error('[getAuthHeaders] ❌ Failed to get user email:', error);
  }
  
  console.error('[getAuthHeaders] ❌ No auth - returning empty headers');
  return {};
}

/**
 * Authenticated fetch wrapper
 * Automatically includes auth headers for Cloud mode requests
 * 
 * ✅ Local mode: No auth headers
 * ✅ Cloud mode: Adds x-user-email header
 */
export async function authFetch(url: string, options?: RequestInit): Promise<Response> {
  const isFormDataBody =
    typeof FormData !== 'undefined' && options?.body instanceof FormData;

  // Default headers:
  // - JSON requests: add Content-Type: application/json
  // - FormData: DO NOT set Content-Type (browser must set multipart boundary)
  const baseHeaders: Record<string, string> = {};
  if (!isFormDataBody) {
    baseHeaders['Content-Type'] = 'application/json';
  }

  const headers = {
    ...baseHeaders,
    ...getAuthHeaders(), // ✅ Empty for local mode
    ...(options?.headers || {})
  } as HeadersInit;
  
  return fetch(url, {
    ...options,
    headers
  });
}

// ========================================
// Server Configuration (read from environment)
// ========================================
// Frontend now determines deployment mode via VITE_DEPLOYMENT_MODE env var
// No need to query backend for mode

export interface ExecuteJobParams {
  projectId: string;
  featureName?: string;  // Optional: if not provided, uses 'skeleton'
  jobType?: string;
  agent?: string;
  mode?: 'generate' | 'refactor' | 'explain';
  language?: string;
  overrideDirective?: string;  // ✅ Chat input becomes directive (highest priority)
  chatSource?: boolean;        // ✅ True if job started from chat (enables Chat SSE)
  skipTriage?: boolean;        // ✅ Skip triage node (after user selects "proceed" on redirect)
}

export interface JobStatus {
  jobId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

export interface Feature {
  name: string;
  path: string;
  createdAt?: string;
}

export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileNode[];
}

export interface FileContent {
  path: string;
  content: string;
}

// ========= Binary File Helpers (Images, etc.) =========

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']);

export function isImageFilePath(filePath: string | undefined | null): boolean {
  if (!filePath) return false;
  const lower = filePath.toLowerCase();
  const ext = lower.lastIndexOf('.') >= 0 ? lower.slice(lower.lastIndexOf('.')) : '';
  return IMAGE_EXTENSIONS.has(ext);
}

export function isSvgFilePath(filePath: string | undefined | null): boolean {
  if (!filePath) return false;
  return filePath.toLowerCase().endsWith('.svg');
}

/**
 * Binary image files (non-text). Note: SVG is excluded because it is text-editable.
 */
export function isBinaryImageFilePath(filePath: string | undefined | null): boolean {
  return isImageFilePath(filePath) && !isSvgFilePath(filePath);
}

/**
 * Fetch raw file as Blob (binary-safe)
 * Uses /files-raw/<path> endpoint.
 */
export async function fetchFileBlob(
  projectId: string,
  featureName: string,
  filePath: string
): Promise<Blob> {
  const url = `${API_BASE()}/projects/${encodeURIComponent(projectId)}/features/${encodeURIComponent(featureName)}/files-raw/${filePath}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      ...getAuthHeaders()
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch file blob: ${response.statusText}`);
  }

  return await response.blob();
}

export interface AgentJobInfo {
  value: string;
  label: string;
}

export interface Agent {
  value: string;
  label: string;
  enabled: boolean;
  jobs: AgentJobInfo[];
}

export interface LogEntry {
  timestamp: string;
  type: 'stdout' | 'stderr';
  message: string;
}

export interface LinkedBackendConfig {
  type: 'url' | 'project';
  url?: string;
  projectId?: string;
  feature?: string;
  resolvedUrlKey?: string;
}

export interface PreviewStatus {
  running: boolean;
  ready?: boolean;  // Health check result
  port?: number | null;
  backendPort?: number | null;
  url?: string | null;
  logs?: LogEntry[];
  setupReasoning?: string;  // Categorized failure code (e.g., 'basename-missing')
  setupReason?: string;     // Human-readable message
  suggestedFix?: string;    // Suggested fix prompt
  packages?: Array<{ name: string; type: 'frontend' | 'backend' | 'other'; port: number }>;
  issues?: Array<{ reasoning: string; severity: 'fatal' | 'warning'; reason: string; suggestedFix?: string }>;
  phase?: 'idle' | 'installing' | 'starting' | 'running' | 'error' | 'stopped';  // Explicit phase from backend
  error?: string;  // Error message from backend (install failure, health check failure, etc.)
  structureType?: 'frontend-only' | 'backend-only' | 'fullstack' | 'monorepo' | null;
  linkedBackend?: LinkedBackendConfig | null;
  canStart?: boolean;  // Whether preview server can be started (filesystem-based check)
}

export interface PreviewConfig {
  structureType?: 'frontend-only' | 'backend-only' | 'fullstack' | 'monorepo' | null;
  linkedBackend?: LinkedBackendConfig | null;
}


// ========== Models ==========

export interface LLMModelInfo {
  id: string;
  displayName: string;
  provider: 'anthropic' | 'openai';
  description?: string;
  recommended?: boolean;
  capabilities?: string[];
}

export interface AvailableModelsResponse {
  models: LLMModelInfo[];
  default: string;
}

// Health check function to verify API connection
export async function checkHealth(): Promise<boolean> {
  try {
    const url = `${API_BASE()}/health`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });
    
    if (!response.ok) {
      return false;
    }
    
    const data = await response.json();
    return data.status === 'ok';
  } catch (error) {
    console.error('Health check failed:', error);
    return false;
  }
}

/**
 * Fetch available LLM models
 */
export async function fetchAvailableModels(): Promise<AvailableModelsResponse> {
  try {
    const response = await authFetch(`${API_BASE()}/models`);
    
    if (!response.ok) {
      throw new Error(`Failed to fetch available models: ${response.statusText}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('Error fetching available models:', error);
    // Return empty list on error
    return {
      models: [],
      default: 'claude-sonnet-4-5-20250929'  // ✅ Latest default
    };
  }
}

export async function fetchProjects(): Promise<string[]> {
  try {
    const url = `${API_BASE()}/projects`;
    const response = await authFetch(url);
    
    if (!response.ok) {
      throw new Error(`Failed to fetch projects: ${response.statusText}`);
    }
    
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('[API] Error fetching projects:', error);
    throw error;
  }
}

export async function fetchAgents(): Promise<Agent[]> {
  try {
    const url = `${API_BASE()}/agents`;
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`Failed to fetch agents: ${response.statusText}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('Error fetching agents:', error);
    throw error;
  }
}

export async function createProject(projectId: string): Promise<void> {
  try {
    const url = `${API_BASE()}/projects`;
    const response = await authFetch(url, {
      method: 'POST',
      body: JSON.stringify({ id: projectId }),
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || `Failed to create project: ${response.statusText}`);
    }
  } catch (error) {
    console.error('Error creating project:', error);
    throw error;
  }
}

export async function deleteProject(projectId: string): Promise<void> {
  try {
    const url = `${API_BASE()}/projects/${encodeURIComponent(projectId)}`;
    const response = await authFetch(url, {
      method: 'DELETE',
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || `Failed to delete project: ${response.statusText}`);
    }
  } catch (error) {
    console.error('Error deleting project:', error);
    throw error;
  }
}

export async function fetchSession(projectId: string): Promise<Session | null> {
  try {
    const response = await authFetch(`${API_BASE()}/projects/${encodeURIComponent(projectId)}/session`);
    
    if (response.status === 404) {
      return null;
    }
    
    if (!response.ok) {
      throw new Error(`Failed to fetch session: ${response.statusText}`);
    }
    
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error fetching session:', error);
    throw error;
  }
}

export async function executeJob(params: ExecuteJobParams): Promise<{ jobId: string; error?: string; missingMaterials?: any[] }> {
  try {
    const { 
      projectId, 
      featureName,
      jobType: task = 'code', 
      agent, 
      mode = 'generate', 
      language = 'en',
      overrideDirective,  // ✅ Chat input as directive
      chatSource,          // ✅ Flag for Chat SSE
      skipTriage           // ✅ Skip triage (after proceed choice)
    } = params;
    
    // ✅ Feature name is required
    if (!featureName) {
      throw new Error('Feature name is required for job execution');
    }
    
    const requestBody = {
      task,
      agent,
      mode,
      language,
      overrideDirective,  // ✅ Include in request
      chatSource,          // ✅ Include in request
      skipTriage           // ✅ Include in request
    };
    
    // ✅ Always use feature-specific endpoint (featureName defaults to 'skeleton')
    const endpoint = `${API_BASE()}/projects/${encodeURIComponent(projectId)}/features/${encodeURIComponent(featureName)}/execute`;
    
    const response = await authFetch(endpoint, {
      method: 'POST',
      body: JSON.stringify(requestBody),
    });
    
    const data = await response.json();
    
    // ✅ Check for prerequisites validation failure
    if (!data.success && data.error && data.missingMaterials) {
      // Return error with details instead of throwing
      return {
        jobId: data.jobId,
        error: data.error,
        missingMaterials: data.missingMaterials
      };
    }
    
    if (!response.ok) {
      throw new Error(`Failed to execute task: ${response.statusText}`);
    }
    
    return data;
  } catch (error) {
    console.error('Error executing task:', error);
    throw error;
  }
}

export async function clearSessionData(
  projectId: string,
  featureName: string,
  jobType: string
): Promise<void> {
  const response = await authFetch(
    `${API_BASE()}/projects/${projectId}/features/${featureName}/session?job=${jobType}`,
    {
      method: 'DELETE',
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to clear session data: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Clear chat history for a feature (chat.json only)
 */
export async function clearChatHistory(
  projectId: string,
  featureName: string
): Promise<void> {
  const response = await authFetch(
    `${API_BASE()}/projects/${projectId}/features/${featureName}/chat/messages`,
    {
      method: 'DELETE',
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to clear chat history: ${response.statusText}`);
  }

  return response.json();
}

export async function stopJob(
  jobId: string, 
  projectId?: string, 
  featureName?: string, 
  jobType?: string
): Promise<void> {
  try {
    const response = await authFetch(`${API_BASE()}/jobs/${encodeURIComponent(jobId)}/stop`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ projectId, featureName, jobType }),
    });
    
    if (!response.ok) {
      throw new Error(`Failed to stop task: ${response.statusText}`);
    }
    
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error stopping task:', error);
    throw error;
  }
}

/**
 * Resume existing job by jobId
 * Server will automatically detect job type from session files
 */
export async function resumeJob(
  jobId: string,
  projectId: string,
  featureName: string,
  chatSource: boolean = true  // ✅ Enable Chat SSE by default
): Promise<{ jobId: string; originalJobId: string; jobType: string }> {
  try {
    console.log(`[api.ts] resumeJob called: ${jobId}, chatSource: ${chatSource}`);
    
    // ✅ authFetch already adds Content-Type and auth headers
    const response = await authFetch(`${API_BASE()}/jobs/${encodeURIComponent(jobId)}/resume`, {
      method: 'POST',
      body: JSON.stringify({ projectId, featureName, chatSource }),
    });
    
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error(error.error || `Failed to resume job: ${response.statusText}`);
    }
    
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error resuming job:', error);
    throw error;
  }
}

/**
 * Continue a running job with additional directive (highest priority)
 * Used when user sends a new message while job is still in progress
 */
export async function continueJob(
  jobId: string,
  projectId: string,
  featureName: string,
  newDirective: string,
  chatSource: boolean = true
): Promise<{ jobId: string; originalJobId: string; jobType: string; directivesCount: number }> {
  try {
    console.log(`[api.ts] continueJob called: ${jobId}, newDirective length: ${newDirective.length}, chatSource: ${chatSource}`);
    
    // ✅ authFetch already adds Content-Type and auth headers
    const response = await authFetch(`${API_BASE()}/jobs/${encodeURIComponent(jobId)}/continue`, {
      method: 'POST',
      body: JSON.stringify({ projectId, featureName, newDirective, chatSource }),
    });
    
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error(error.error || `Failed to continue job: ${response.statusText}`);
    }
    
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error continuing job:', error);
    throw error;
  }
}

/**
 * Send an inline ask during an interrupted job.
 * Runs triage classification: if ask intent, responds in chat; if work intent, signals frontend to continue.
 * Does NOT affect the interrupted job's state (stateless, no session modification).
 */
export async function inlineAsk(
  projectId: string,
  featureName: string,
  message: string,
  chatSource: boolean = true
): Promise<{ jobId: string; jobType: string }> {
  try {
    console.log(`[api.ts] inlineAsk called: ${projectId}/${featureName}, message length: ${message.length}`);
    
    const response = await authFetch(
      `${API_BASE()}/projects/${encodeURIComponent(projectId)}/features/${encodeURIComponent(featureName)}/inline-ask`,
      {
        method: 'POST',
        body: JSON.stringify({ message, chatSource }),
      }
    );
    
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error(error.error || `Failed to start inline ask: ${response.statusText}`);
    }
    
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error starting inline ask:', error);
    throw error;
  }
}

export interface QueueStatus {
  currentTask: {
    name: string;
    type: string;
    status: string;
    timing?: TaskTiming;
  } | null;
  queue: Array<{
    name: string;
    type: string;
    status: string;
    timing?: TaskTiming;
  }>;
  totalRemaining: number;
  estimatingMessage?: string | null;
}

export async function fetchQueueStatus(jobId: string): Promise<QueueStatus> {
  try {
    const response = await authFetch(`${API_BASE()}/tasks/${encodeURIComponent(jobId)}/queue`);
    
    if (!response.ok) {
      throw new Error(`Failed to fetch queue status: ${response.statusText}`);
    }
    
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error fetching queue status:', error);
    throw error;
  }
}

export async function fetchJobStatus(jobId: string): Promise<JobStatus> {
  try {
    const response = await authFetch(`${API_BASE()}/tasks/${encodeURIComponent(jobId)}/status`);
    
    if (!response.ok) {
      throw new Error(`Failed to fetch task status: ${response.statusText}`);
    }
    
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error fetching task status:', error);
    throw error;
  }
}

// ========== Queue Position ==========

export interface QueuePositionInfo {
  status: string;
  position: number | null;
  totalWaiting: number;
  estimatedWaitMs?: number;
}

export async function fetchQueuePosition(jobId: string): Promise<QueuePositionInfo> {
  try {
    const response = await authFetch(`${API_BASE()}/jobs/${encodeURIComponent(jobId)}/queue-position`);
    
    if (!response.ok) {
      throw new Error(`Failed to fetch queue position: ${response.statusText}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('Error fetching queue position:', error);
    // Return default values on error
    return { status: 'unknown', position: null, totalWaiting: 0 };
  }
}

// ========== Feature Management ==========

export async function fetchFeatures(projectId: string): Promise<Feature[]> {
  try {
    const response = await authFetch(`${API_BASE()}/projects/${encodeURIComponent(projectId)}/features`);
    
    if (!response.ok) {
      throw new Error(`Failed to fetch features: ${response.statusText}`);
    }
    
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error fetching features:', error);
    throw error;
  }
}

export async function createFeature(projectId: string, featureName: string, language?: string): Promise<void> {
  try {
    const response = await authFetch(`${API_BASE()}/projects/${encodeURIComponent(projectId)}/features`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ featureName, language }),
    });
    
    if (!response.ok) {
      const errBody = await response.json().catch(() => null as any);
      const message =
        errBody?.error ||
        errBody?.message ||
        `Failed to create feature: ${response.statusText}`;
      const err: any = new Error(message);
      if (errBody?.code) err.code = errBody.code;
      throw err;
    }
  } catch (error) {
    console.error('Error creating feature:', error);
    throw error;
  }
}

export async function deleteFeature(projectId: string, featureName: string): Promise<void> {
  try {
    const response = await authFetch(
      `${API_BASE()}/projects/${encodeURIComponent(projectId)}/features/${encodeURIComponent(featureName)}`,
      { method: 'DELETE' }
    );
    
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new Error(body?.message || `Failed to delete feature: ${response.statusText}`);
    }
  } catch (error) {
    console.error('Error deleting feature:', error);
    throw error;
  }
}

export async function fetchFeatureSession(projectId: string, featureName: string, job: string = 'code'): Promise<Session | null> {
  try {
    const url = `${API_BASE()}/projects/${encodeURIComponent(projectId)}/features/${encodeURIComponent(featureName)}/session?job=${job}`;  // ✅ Add job query param
    const response = await authFetch(url);
    
    if (response.status === 404) {
      return null;
    }
    
    if (!response.ok) {
      throw new Error(`Failed to fetch feature session: ${response.statusText}`);
    }
    
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error fetching feature session:', error);
    throw error;
  }
}

// ========================================
// 📊 KANBAN API - Complete View Model
// ========================================
// Re-export shared types (canonical source: @ant/shared)
export type {
  TaskType, TaskStatus,
  JobType, DecomposableJobType, JobTiming,
  TaskTiming, TaskTokenUsage,
  BaseTask, KanbanData,
  InterruptionReason, InterruptionDetails,
} from '@ant/shared';



/**
 * Fetch complete Kanban board data for a feature
 * Returns ready-to-render data (no client-side merging needed)
 */
export async function fetchKanbanData(projectId: string, featureName: string, job: string = 'code'): Promise<KanbanData> {
  try {
    const url = `${API_BASE()}/projects/${encodeURIComponent(projectId)}/features/${encodeURIComponent(featureName)}/kanban?job=${job}`;  // ✅ Add job query param
    const response = await authFetch(url);
    
    if (!response.ok) {
      throw new Error(`Failed to fetch kanban data: ${response.statusText}`);
    }
    
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error fetching kanban data:', error);
    // Return empty kanban on error
    return {
      todo: [],
      inProgress: [],
      completed: [],
      isEstimating: false,
      dataSource: 'session',
    };
  }
}

// ========== File Management ==========

export async function fetchFileTree(projectId: string, featureName: string): Promise<FileNode[]> {
  try {
    const response = await authFetch(
      `${API_BASE()}/projects/${encodeURIComponent(projectId)}/features/${encodeURIComponent(featureName)}/files`
    );
    
    if (!response.ok) {
      throw new Error(`Failed to fetch file tree: ${response.statusText}`);
    }
    
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error fetching file tree:', error);
    throw error;
  }
}

export async function fetchFileContent(
  projectId: string,
  featureName: string,
  filePath: string
): Promise<FileContent> {
  try {
    const response = await authFetch(
      `${API_BASE()}/projects/${encodeURIComponent(projectId)}/features/${encodeURIComponent(featureName)}/files/${filePath}`
    );
    
    if (!response.ok) {
      throw new Error(`Failed to fetch file content: ${response.statusText}`);
    }
    
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error fetching file content:', error);
    throw error;
  }
}

export async function saveFileContent(
  projectId: string,
  featureName: string,
  filePath: string,
  content: string
): Promise<void> {
  try {
    const response = await authFetch(
      `${API_BASE()}/projects/${encodeURIComponent(projectId)}/features/${encodeURIComponent(featureName)}/files/${filePath}`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content }),
      }
    );
    
    if (!response.ok) {
      throw new Error(`Failed to save file content: ${response.statusText}`);
    }
  } catch (error) {
    console.error('Error saving file content:', error);
    throw error;
  }
}

// Create a new empty file
export async function createFile(
  projectId: string,
  featureName: string,
  filePath: string,
  content: string = ''
): Promise<void> {
  try {
    const response = await authFetch(
      `${API_BASE()}/projects/${encodeURIComponent(projectId)}/features/${encodeURIComponent(featureName)}/files/${filePath}`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content }),
      }
    );
    
    if (!response.ok) {
      throw new Error(`Failed to create file: ${response.statusText}`);
    }
  } catch (error) {
    console.error('Error creating file:', error);
    throw error;
  }
}

// Upload files (using FormData for binary files)
export async function uploadFiles(
  projectId: string,
  featureName: string,
  dirPath: string,
  files: FileList
): Promise<{ uploadedFiles: string[]; count: number }> {
  try {
    const formData = new FormData();
    Array.from(files).forEach((file) => {
      formData.append('files', file);
    });
    formData.append('dirPath', dirPath);

    const response = await authFetch(
      `${API_BASE()}/projects/${encodeURIComponent(projectId)}/features/${encodeURIComponent(featureName)}/upload`,
      {
        method: 'POST',
        body: formData,
      }
    );
    
    if (!response.ok) {
      throw new Error(`Failed to upload files: ${response.statusText}`);
    }
    const data = await response.json();
    return {
      uploadedFiles: data?.uploadedFiles || [],
      count: data?.count || 0
    };
  } catch (error) {
    console.error('Error uploading files:', error);
    throw error;
  }
}

// Delete a file or directory
export async function deleteFileOrDirectory(
  projectId: string,
  featureName: string,
  filePath: string
): Promise<void> {
  try {
    const url = `${API_BASE()}/projects/${encodeURIComponent(projectId)}/features/${encodeURIComponent(featureName)}/item`;
    
    const response = await authFetch(url, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ path: filePath }),
    });
    
    if (!response.ok) {
      throw new Error(`Failed to delete: ${response.statusText}`);
    }
  } catch (error) {
    console.error('Error deleting file/directory:', error);
    throw error;
  }
}

// Create a new directory
export async function createDirectory(
  projectId: string,
  featureName: string,
  dirPath: string
): Promise<void> {
  try {
    const response = await authFetch(
      `${API_BASE()}/projects/${encodeURIComponent(projectId)}/features/${encodeURIComponent(featureName)}/directory`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ path: dirPath }),
      }
    );
    
    if (!response.ok) {
      throw new Error(`Failed to create directory: ${response.statusText}`);
    }
  } catch (error) {
    console.error('Error creating directory:', error);
    throw error;
  }
}

// Job-level LLM configuration
export interface JobLLMConfig {
  default?: string;           // Job-level default model
  decompose?: string;         // Decompose node
  plan?: string;              // Plan node
  docGen?: string;            // Documentation generation (design job only)
  codeGen?: string;           // Code generation (code job only)
  tool?: string;              // Tool execution node
  validate?: string;          // Validation node (code job only)
  learn?: string;             // Learning node
  detectEnvironment?: string; // Environment detection node
}

// Config types
export interface ProjectConfig {
  repositoryName: string;  // Repository/codebase name (sanitized from workspace project name)
  repoType?: 'local' | 'cloud' | 'github';
  localPath?: string;  // Only for repoType='local'
  githubRepo?: string;
  branchBase: string;
  autoLearn: boolean;
  strictValidation?: boolean;
  llmModels?: {
    design?: JobLLMConfig;
    code?: JobLLMConfig;
    learn?: JobLLMConfig;
  };
}

// Fetch project config
export async function fetchProjectConfig(projectId: string): Promise<ProjectConfig | null> {
  try {
    const response = await authFetch(
      `${API_BASE()}/projects/${encodeURIComponent(projectId)}/config`
    );
    
    if (response.status === 404) {
      return null; // Config doesn't exist
    }
    
    if (!response.ok) {
      throw new Error(`Failed to fetch config: ${response.statusText}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('Error fetching config:', error);
    throw error;
  }
}

// Sanitize workspace ID to valid repository name (alphanumeric + hyphens)
function sanitizeRepositoryName(workspaceId: string): string {
  return workspaceId
    .toLowerCase()
    .replace(/\s+/g, '-')           // spaces → hyphens
    .replace(/[^a-z0-9-]/g, '')     // remove non-alphanumeric except hyphens
    .replace(/-+/g, '-')            // multiple hyphens → single hyphen
    .replace(/^-+|-+$/g, '');       // trim leading/trailing hyphens
}

// Create project config with defaults
export async function createProjectConfig(projectId: string): Promise<ProjectConfig> {
  const sanitizedName = sanitizeRepositoryName(projectId);
  
  const defaultConfig: ProjectConfig = {
    repositoryName: sanitizedName,
    repoType: 'local',
    localPath: `~/dev/${sanitizedName}`,
    branchBase: 'main',
    autoLearn: true,
    // Note: llmProvider and llmModel will be set by backend from environment variables
  };
  
  try {
    const response = await authFetch(
      `${API_BASE()}/projects/${encodeURIComponent(projectId)}/config`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(defaultConfig),
      }
    );
    
    if (!response.ok) {
      throw new Error(`Failed to create config: ${response.statusText}`);
    }
    
    return defaultConfig;
  } catch (error) {
    console.error('Error creating config:', error);
    throw error;
  }
}

// Update project config
export async function updateProjectConfig(projectId: string, config: ProjectConfig): Promise<ProjectConfig> {
  try {
    const response = await authFetch(
      `${API_BASE()}/projects/${encodeURIComponent(projectId)}/config`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(config),
      }
    );
    
    if (!response.ok) {
      throw new Error(`Failed to update config: ${response.statusText}`);
    }
    
    // Backend now returns the saved config
    return await response.json();
  } catch (error) {
    console.error('Error updating config:', error);
    throw error;
  }
}

// Preview server management
// Note: Preview requests go to ant-preview host (VITE_PREVIEW_HOST)
export async function startPreview(
  projectId: string, 
  feature?: string,
  port?: number
): Promise<{ success: boolean; message: string; script?: string; status?: any }> {
  try {
    const response = await authFetch(
      `${PREVIEW_BASE()}/projects/${encodeURIComponent(projectId)}/start`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          feature: feature || 'main',
          port 
        }),
      }
    );
    
    if (!response.ok) {
      const errorData = await response.json();
      const err: any = new Error(errorData.error || `Failed to start preview: ${response.statusText}`);
      // Attach validation info to error for frontend to display Fix button
      err.setupReasoning = errorData.setupReasoning;  // Categorized failure code
      err.setupReason = errorData.setupReason;        // Human-readable message
      err.suggestedFix = errorData.suggestedFix;
      // ✅ Unified issue queue (fatal + warnings) for Fix All
      err.issues = errorData.issues;
      throw err;
    }
    
    return await response.json();
  } catch (error) {
    console.error('Error starting preview:', error);
    throw error;
  }
}

export async function stopPreview(projectId: string, feature?: string): Promise<{ success: boolean; message: string }> {
  try {
    const response = await authFetch(
      `${PREVIEW_BASE()}/projects/${encodeURIComponent(projectId)}/stop`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ feature: feature || 'main' }),
      }
    );
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || `Failed to stop preview: ${response.statusText}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('Error stopping preview:', error);
    throw error;
  }
}

export async function getPreviewStatus(projectId: string, feature?: string): Promise<PreviewStatus> {
  try {
    const featureParam = feature ? `?feature=${encodeURIComponent(feature)}` : '';
    const response = await authFetch(
      `${PREVIEW_BASE()}/projects/${encodeURIComponent(projectId)}/status${featureParam}`
    );
    
    if (!response.ok) {
      throw new Error(`Failed to get preview status: ${response.statusText}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('Error getting preview status:', error);
    throw error;
  }
}

/**
 * Get preview configuration (structureType, linkedBackend)
 */
export async function getPreviewConfig(projectId: string, feature?: string): Promise<PreviewConfig> {
  try {
    const featureParam = feature ? `?feature=${encodeURIComponent(feature)}` : '';
    const response = await authFetch(
      `${PREVIEW_BASE()}/projects/${encodeURIComponent(projectId)}/preview-config${featureParam}`
    );
    
    if (!response.ok) {
      throw new Error(`Failed to get preview config: ${response.statusText}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('Error getting preview config:', error);
    throw error;
  }
}

/**
 * Update preview configuration (linkedBackend)
 */
export async function updatePreviewConfig(
  projectId: string,
  feature: string,
  config: { linkedBackend?: LinkedBackendConfig | null }
): Promise<{ success: boolean; linkedBackend?: LinkedBackendConfig }> {
  try {
    const response = await authFetch(
      `${PREVIEW_BASE()}/projects/${encodeURIComponent(projectId)}/preview-config`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          feature: feature || 'main',
          linkedBackend: config.linkedBackend,
        }),
      }
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || `Failed to update preview config: ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Error updating preview config:', error);
    throw error;
  }
}


/**
 * Reset job state (remove jobId and jobTiming from session)
 */
export async function resetJobState(
  projectId: string, 
  featureName: string, 
  job: string = 'code'
): Promise<void> {
  try {
    // Use the new clearSessionData API
    await clearSessionData(projectId, featureName, job);
  } catch (error) {
    console.error('Error resetting job state:', error);
    throw error;
  }
}

// ========================================
// Authentication APIs (Cloud Mode)
// ========================================

export interface AuthResponse {
  success: boolean;
  message: string;
  user?: {
    email: string;
    userId: string;
    organization: string;
  };
  error?: string;
}

/**
 * Sign up - Create user workspace
 * 
 * If OAuth is required (production), returns error with redirect URL
 */
export async function signUp(email: string): Promise<AuthResponse> {
  try {
    const response = await fetch(`${API_BASE()}/auth/signup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email }),
    });
    
    const data = await response.json();
    
    // ✅ OAuth required - redirect to Google
    if (response.status === 401 && data.error === 'OAuth required') {
      // Redirect to Google OAuth
      const backendBase = API_BASE().replace('/api', '');
      window.location.href = `${backendBase}/api/auth/google`;
      // Return dummy response (page will redirect)
      return { success: false, message: 'Redirecting to Google OAuth...' };
    }
    
    if (!response.ok) {
      throw new Error(data.message || data.error || 'Sign up failed');
    }
    
    return data;
  } catch (error: any) {
    console.error('Error signing up:', error);
    throw error;
  }
}

/**
 * Sign in - Validate user workspace exists
 * 
 * If OAuth is required (production), returns error with redirect URL
 */
export async function signIn(email: string): Promise<AuthResponse> {
  try {
    const response = await fetch(`${API_BASE()}/auth/signin`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email }),
    });
    
    const data = await response.json();
    
    // ✅ OAuth required - redirect to Google
    if (response.status === 401 && data.error === 'OAuth required') {
      // Redirect to Google OAuth
      const backendBase = API_BASE().replace('/api', '');
      window.location.href = `${backendBase}/api/auth/google`;
      // Return dummy response (page will redirect)
      return { success: false, message: 'Redirecting to Google OAuth...' };
    }
    
    if (!response.ok) {
      throw new Error(data.message || data.error || 'Sign in failed');
    }
    
    return data;
  } catch (error: any) {
    console.error('Error signing in:', error);
    throw error;
  }
}

/**
 * Sign out - Clear user session (client-side only)
 */
export async function signOut(): Promise<void> {
  try {
    await authFetch(`${API_BASE()}/auth/signout`, {
      method: 'POST',
    });
  } catch (error) {
    console.error('Error signing out:', error);
    // Don't throw - sign out should always succeed locally
  }
}

// ========================================
// IDE APIs (Local Mode only)
// ========================================

export interface OpenIDERequest {
  ide: 'cursor' | 'vscode';
  localPath: string;
}

export interface OpenIDEResponse {
  success: boolean;
  message: string;
  ide: string;
  path: string;
  error?: string;
}

export interface CheckIDEResponse {
  ide: string;
  installed: boolean;
  path: string | null;
  error?: string;
}

/**
 * Open local IDE (Cursor or VS Code)
 * Local Mode only
 */
export async function openLocalIDE(ide: 'cursor' | 'vscode', localPath: string): Promise<OpenIDEResponse> {
  try {
    const response = await authFetch(`${API_BASE()}/ide/open`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders()
      },
      body: JSON.stringify({ ide, localPath }),
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.message || data.error || 'Failed to open IDE');
    }
    
    return data;
  } catch (error: any) {
    console.error('Error opening local IDE:', error);
    throw error;
  }
}

/**
 * Check if local IDE is installed
 * Local Mode only
 */
export async function checkIDEInstalled(ide: 'cursor' | 'vscode'): Promise<CheckIDEResponse> {
  try {
    const response = await authFetch(`${API_BASE()}/ide/check/${ide}`, {
      headers: getAuthHeaders()
    });
    
    return await response.json();
  } catch (error: any) {
    console.error(`Error checking ${ide} installation:`, error);
    return {
      ide,
      installed: false,
      path: null,
      error: error.message
    };
  }
}

// ========================================
// Cloud IDE APIs (Docker per project/feature)
// ========================================

export interface CloudIDEInstance {
  url: string;          // proxy url (e.g. /ide/org:user:project) - project-level
  directUrl?: string;   // ✅ local direct access (e.g. http://localhost:45xxx)
  port: number;
  status: string;
  workspacePath?: string;
}

export interface StartCloudIDEResponse {
  success: boolean;
  instance: CloudIDEInstance;
}

/**
 * Start cloud IDE container for a project/feature and return proxy URL for embedding.
 * The proxy URL goes through the main server (/ide/:serverKey) for SSL and routing.
 */
export async function startCloudIDE(projectId: string, featureName: string = 'main'): Promise<StartCloudIDEResponse> {
  const response = await authFetch(`${API_BASE()}/cloud-ide/start`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders()
    },
    body: JSON.stringify({ projectId, featureName }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error || data?.message || 'Failed to start cloud IDE');
  }
  return data;
}

// ============================================
// GitHub Integration
// ============================================

export interface GitHubPATStatus {
  configured: boolean;
  message: string;
  username?: string;  // GitHub username (auto-detected from PAT)
}

export interface SavePATResult {
  success: boolean;
  username?: string;
  error?: string;
  message?: string;
}

/**
 * Check if GitHub PAT is configured
 */
export async function checkGitHubPATStatus(): Promise<GitHubPATStatus> {
  try {
    const response = await authFetch(`${API_BASE()}/github/pat/status`);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    return await response.json();
  } catch (error: any) {
    console.error('Error checking GitHub PAT status:', error);
    return {
      configured: false,
      message: 'Failed to check PAT status'
    };
  }
}

/**
 * Save GitHub PAT
 */
export async function saveGitHubPAT(pat: string): Promise<SavePATResult> {
  try {
    const response = await authFetch(`${API_BASE()}/github/pat`, {
      method: 'POST',
      body: JSON.stringify({ pat })
    });
    
    const result = await response.json();
    
    if (!response.ok) {
      return {
        success: false,
        error: result.error || `HTTP ${response.status}`
      };
    }
    
    return result;
  } catch (error: any) {
    console.error('Error saving GitHub PAT:', error);
    return {
      success: false,
      error: error.message || 'Network error'
    };
  }
}

/**
 * Delete GitHub PAT
 */
export async function deleteGitHubPAT(): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await authFetch(`${API_BASE()}/github/pat`, {
      method: 'DELETE'
    });
    
    if (!response.ok) {
      const result = await response.json();
      return {
        success: false,
        error: result.error || `HTTP ${response.status}`
      };
    }
    
    return { success: true };
  } catch (error: any) {
    console.error('Error deleting GitHub PAT:', error);
    return {
      success: false,
      error: error.message || 'Network error'
    };
  }
}

/**
 * Clone GitHub repository to project
 */
export async function cloneGitHubRepo(projectId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await authFetch(`${API_BASE()}/projects/${encodeURIComponent(projectId)}/clone`, {
      method: 'POST'
    });
    
    const result = await response.json();
    
    if (!response.ok) {
      return {
        success: false,
        error: result.error || `HTTP ${response.status}`
      };
    }
    
    return { success: true };
  } catch (error: any) {
    console.error('Error cloning GitHub repo:', error);
    return {
      success: false,
      error: error.message || 'Network error'
    };
  }
}

/**
 * Check if project is cloned (has .git directory)
 */
export async function checkCloneStatus(projectId: string): Promise<{ cloned: boolean; error?: string }> {
  try {
    const response = await authFetch(`${API_BASE()}/projects/${encodeURIComponent(projectId)}/clone/status`);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const result = await response.json();
    return { cloned: result.cloned };
  } catch (error: any) {
    console.error('Error checking clone status:', error);
    return {
      cloned: false,
      error: error.message || 'Network error'
    };
  }
}

/**
 * Initialize GitHub repository (create new repo and push)
 */
export async function initializeGitHubRepo(projectId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await authFetch(`${API_BASE()}/projects/${encodeURIComponent(projectId)}/initialize`, {
      method: 'POST'
    });
    
    const result = await response.json();
    
    if (!response.ok) {
      return {
        success: false,
        error: result.error || `HTTP ${response.status}`
      };
    }
    
    return { success: true };
  } catch (error: any) {
    console.error('Error initializing GitHub repo:', error);
    return {
      success: false,
      error: error.message || 'Network error'
    };
  }
}

/**
 * Publish existing codebase to a new GitHub repository.
 * Unlike initialize, this allows features to already exist and creates branches for them.
 */
export async function publishToGitHub(projectId: string, activeFeature?: string): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await authFetch(`${API_BASE()}/projects/${encodeURIComponent(projectId)}/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activeFeature })
    });
    
    const result = await response.json();
    
    if (!response.ok) {
      return {
        success: false,
        error: result.error || `HTTP ${response.status}`
      };
    }
    
    return { success: true };
  } catch (error: any) {
    console.error('Error publishing to GitHub:', error);
    return {
      success: false,
      error: error.message || 'Network error'
    };
  }
}

/**
 * Push changes to GitHub
 */
export async function pushToGitHub(projectId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await authFetch(`${API_BASE()}/projects/${encodeURIComponent(projectId)}/push`, {
      method: 'POST'
    });
    
    const result = await response.json();
    
    if (!response.ok) {
      return {
        success: false,
        error: result.error || `HTTP ${response.status}`
      };
    }
    
    return { success: true };
  } catch (error: any) {
    console.error('Error pushing to GitHub:', error);
    return {
      success: false,
      error: error.message || 'Network error'
    };
  }
}

// ========================================
// Figma MCP Integration APIs
// ========================================

export interface FigmaConfigStatus {
  configured: boolean;
  enabled?: boolean;
  userId?: string;
  email?: string;
  autoExtractTokens?: boolean;
  autoGenerateCode?: boolean;
  defaultFileFormat?: string;
  updatedAt?: string;
}

/**
 * Check if Figma OAuth is configured
 */
export async function checkFigmaConfigStatus(): Promise<FigmaConfigStatus> {
  try {
    const response = await authFetch(`${API_BASE()}/figma/config`);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('[checkFigmaConfigStatus] Error response:', errorText);
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }
    
    const data = await response.json();
    return data;
  } catch (error: any) {
    console.error('[checkFigmaConfigStatus] ❌ Error:', error);
    return {
      configured: false
    };
  }
}

/**
 * Start Figma OAuth flow
 * Opens OAuth window and returns immediately
 * 
 * Note: This opens Figma's OAuth login page, separate from ANT authentication
 */
export async function startFigmaOAuth(): Promise<void> {
  // Get ANT user context for storing the token after OAuth completes
  // Use same logic as getAuthHeaders() to ensure consistency
  const backendMode = getBackendMode();
  let userEmail = 'local@local'; // Default for Local mode
  
  if (backendMode === 'cloud') {
    try {
      const stored = localStorage.getItem('ant-ui:user-email');
      if (stored) {
        userEmail = JSON.parse(stored);
      } else {
        console.error('[Figma OAuth] ❌ No user email in localStorage for cloud mode!');
        throw new Error('User email not found. Please log in again.');
      }
    } catch (error) {
      console.error('[Figma OAuth] Failed to get user email:', error);
      throw error;
    }
  }
  
  const authUrl = `${API_BASE()}/figma/oauth/authorize?user-email=${encodeURIComponent(userEmail)}`;
  
  // Open Figma OAuth in popup window
  const width = 600;
  const height = 700;
  const left = (window.screen.width - width) / 2;
  const top = (window.screen.height - height) / 2;
  
  window.open(
    authUrl,
    'FigmaOAuth',
    `width=${width},height=${height},left=${left},top=${top}`
  );
}

/**
 * Disconnect Figma OAuth
 */
export async function disconnectFigma(): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await authFetch(`${API_BASE()}/figma/oauth/disconnect`, {
      method: 'POST'
    });
    
    if (!response.ok) {
      const result = await response.json();
      return {
        success: false,
        error: result.error || `HTTP ${response.status}`
      };
    }
    
    return { success: true };
  } catch (error: any) {
    console.error('Error disconnecting Figma:', error);
    return {
      success: false,
      error: error.message || 'Network error'
    };
  }
}

/**
 * Pull changes from GitHub
 */
export async function pullFromGitHub(projectId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await authFetch(`${API_BASE()}/projects/${encodeURIComponent(projectId)}/pull`, {
      method: 'POST'
    });
    
    const result = await response.json();
    
    if (!response.ok) {
      return {
        success: false,
        error: result.error || `HTTP ${response.status}`
      };
    }
    
    return { success: true };
  } catch (error: any) {
    console.error('Error pulling from GitHub:', error);
    return {
      success: false,
      error: error.message || 'Network error'
    };
  }
}

/**
 * Fetch from GitHub (update remote refs)
 */
export async function fetchFromGitHub(projectId: string, feature?: string): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await authFetch(`${API_BASE()}/projects/${encodeURIComponent(projectId)}/fetch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ feature })
    });
    
    const result = await response.json();
    
    if (!response.ok) {
      return {
        success: false,
        error: result.error || `HTTP ${response.status}`
      };
    }
    
    return { success: true };
  } catch (error: any) {
    console.error('Error fetching from GitHub:', error);
    return {
      success: false,
      error: error.message || 'Network error'
    };
  }
}

/**
 * Get Git status for project
 */
export async function getGitStatus(projectId: string): Promise<{
  hasGit: boolean;
  hasCodebase: boolean;
  hasFeatures: boolean;
  currentBranch?: string;
}> {
  try {
    const response = await authFetch(`${API_BASE()}/projects/${encodeURIComponent(projectId)}/git/status`);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    return await response.json();
  } catch (error: any) {
    console.error('Error getting Git status:', error);
    return {
      hasGit: false,
      hasCodebase: false,
      hasFeatures: false
    };
  }
}

/**
 * Get Git changes with detailed file status and ahead/behind information
 */
export async function getGitChanges(projectId: string): Promise<{
  hasChanges: boolean;
  staged: string[];
  unstaged: string[];
  untracked: string[];
  ahead: number;
  behind: number;
  currentBranch?: string;
  isGitInitialized?: boolean; // ✅ NEW: From backend
}> {
  const response = await authFetch(`${API_BASE()}/projects/${encodeURIComponent(projectId)}/git/changes`);
  
  if (!response.ok) {
    throw new Error('Failed to get Git changes');
  }
  
  return await response.json();
}

/**
 * Commit changes with auto-generated or custom message
 */
export async function commitGitChanges(projectId: string, message?: string): Promise<{
  success: boolean;
  commitHash?: string;
  error?: string;
}> {
  const response = await authFetch(
    `${API_BASE()}/projects/${encodeURIComponent(projectId)}/git/commit`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message })
    }
  );
  
  return await response.json();
}

/**
 * Sync with remote (pull then push)
 */
export async function syncWithRemote(projectId: string): Promise<{
  success: boolean;
  pulledChanges?: boolean;
  pushedChanges?: boolean;
  error?: string;
}> {
  const response = await authFetch(
    `${API_BASE()}/projects/${encodeURIComponent(projectId)}/git/sync`,
    {
      method: 'POST'
    }
  );
  
  return await response.json();
}

/**
 * Switch to feature branch
 */
export async function switchToFeatureBranch(
  projectId: string,
  featureName: string
): Promise<{ success: boolean; error?: string; branchName?: string; currentBranch?: string }> {
  try {
    const response = await authFetch(
      `${API_BASE()}/projects/${encodeURIComponent(projectId)}/features/${encodeURIComponent(featureName)}/checkout`,
      { method: 'POST' }
    );
    
    const result = await response.json();
    
    if (!response.ok) {
      return {
        success: false,
        error: result.error || `HTTP ${response.status}`
      };
    }
    
    return { 
      success: true, 
      branchName: result.branchName,
      currentBranch: result.currentBranch  // ✅ Return actual current branch from Git
    };
  } catch (error: any) {
    console.error('Error switching branch:', error);
    return {
      success: false,
      error: error.message || 'Network error'
    };
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Triage Choice API
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export type TriageChoiceAction = 'proceed' | 'proceedAnyway' | 'redirect' | 'guide';

export interface TriageChoiceResponse {
  type: 'guide' | 'continue' | 'dismiss';
  message?: string;
  action?: TriageChoiceAction;
  suggestedAgent?: string;  // For redirect - target agent to switch to
  suggestedJob?: string;    // For redirect - target job to switch to
  directive?: string;       // For redirect - original directive to pass to new job
}

/**
 * Submit user's triage choice
 */
export async function submitTriageChoice(
  projectId: string,
  featureName: string,
  jobId: string,
  choice: TriageChoiceAction
): Promise<TriageChoiceResponse> {
  try {
    const response = await authFetch(
      `${API_BASE()}/projects/${encodeURIComponent(projectId)}/features/${encodeURIComponent(featureName)}/chat/triage-choice`,
      {
        method: 'POST',
        body: JSON.stringify({ jobId, choice })
      }
    );
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || `HTTP ${response.status}`);
    }
    
    return await response.json();
  } catch (error: any) {
    console.error('[API] submitTriageChoice error:', error);
    throw error;
  }
}


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Eval Save API
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Submit eval save choice - save evaluation report to outputs/evals/{evalType}/
 */
export async function submitEvalSave(
  projectId: string,
  featureName: string,
  evalType: string,
  content: string
): Promise<{ success: boolean; path?: string; resolvedLabel?: string }> {
  try {
    const response = await authFetch(
      `${API_BASE()}/projects/${encodeURIComponent(projectId)}/features/${encodeURIComponent(featureName)}/chat/eval-save`,
      {
        method: 'POST',
        body: JSON.stringify({ evalType, content })
      }
    );
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || `HTTP ${response.status}`);
    }
    
    return await response.json();
  } catch (error: any) {
    console.error('[API] submitEvalSave error:', error);
    throw error;
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PRD Apply API
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Submit PRD apply choice - copy outputs/plan/prd-refine.md to inputs/sources/prd.md
 */
export async function submitPrdApply(
  projectId: string,
  featureName: string
): Promise<{ success: boolean; resolvedLabel?: string }> {
  try {
    const response = await authFetch(
      `${API_BASE()}/projects/${encodeURIComponent(projectId)}/features/${encodeURIComponent(featureName)}/chat/prd-apply`,
      {
        method: 'POST',
      }
    );
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || `HTTP ${response.status}`);
    }
    
    return await response.json();
  } catch (error: any) {
    console.error('[API] submitPrdApply error:', error);
    throw error;
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Generic Choice Dismiss API
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Persist any choice card action to backend — survives page refresh in multi-pod.
 * 
 * Unified endpoint for ALL choice card types:
 *   - cancelled: Resume/Dismiss (with metadataFilter: { jobId })
 *   - choice_card: Save/Skip/Apply/KeepDraft (with metadataFilter: { cardType })
 *   - triage_choice: handled by its own endpoint (has side effects)
 * 
 * @param metadataFilter - Optional filter for precise content targeting.
 *   Ensures correct content is updated when multiple contents share the same type.
 */
export async function submitChoiceDismiss(
  projectId: string,
  featureName: string,
  contentType: string,
  choiceAction: string,
  resolvedLabel: string,
  metadataFilter?: Record<string, string>,
  extraMetadata?: Record<string, any>
): Promise<{ success: boolean; choiceAction: string; resolvedLabel: string }> {
  try {
    const response = await authFetch(
      `${API_BASE()}/projects/${encodeURIComponent(projectId)}/features/${encodeURIComponent(featureName)}/chat/dismiss-choice`,
      {
        method: 'POST',
        body: JSON.stringify({ contentType, choiceAction, resolvedLabel, metadataFilter, extraMetadata })
      }
    );
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || `HTTP ${response.status}`);
    }
    
    return await response.json();
  } catch (error: any) {
    console.error('[API] submitChoiceDismiss error:', error);
    throw error;
  }
}

// ============================================================================
// Transfer API
// ============================================================================

export interface TransferRequest {
  id: string;
  sender: { orgId: string; userId: string };
  recipient: { orgId: string; userId: string };
  source: { projectId: string; featureId: string; path: string };
  destination: { projectId: string; featureId: string; path: string };
  mode: 'copy' | 'move';
  status: 'pending' | 'approved' | 'rejected' | 'cancelled' | 'expired' | 'completed';
  createdAt: string;
  expiresAt: string;
  payloadPath: string;
  /** Number of files in the payload (for directory transfers) */
  fileCount?: number;
}

export interface TransferResult {
  success: boolean;
  filesTransferred: number;
  skipped?: string[];
  errors?: string[];
}

/**
 * Self-transfer (immediate, no approval)
 */
export async function transferArtifact(params: {
  source: { projectId: string; featureId: string; path: string };
  destination: { projectId: string; featureId: string; path: string };
  mode: 'copy' | 'move';
}): Promise<TransferResult> {
  const response = await authFetch(`${API_BASE()}/artifacts/transfer`, {
    method: 'POST',
    body: JSON.stringify(params),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || `HTTP ${response.status}`);
  }
  return response.json();
}

/**
 * Cross-user transfer request (requires approval)
 */
export async function requestTransfer(params: {
  recipient: { userId: string; orgId?: string };
  source: { projectId: string; featureId: string; path: string };
  destination: { projectId: string; featureId: string; path: string };
}): Promise<TransferRequest> {
  const response = await authFetch(`${API_BASE()}/artifacts/transfer-request`, {
    method: 'POST',
    body: JSON.stringify(params),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || `HTTP ${response.status}`);
  }
  return response.json();
}

/**
 * List transfer requests (received or sent)
 */
export async function fetchTransferRequests(
  direction: 'received' | 'sent' = 'received',
  status?: string
): Promise<{ requests: TransferRequest[]; count: number; pendingCount: number }> {
  const params = new URLSearchParams({ direction });
  if (status) params.set('status', status);
  
  const response = await authFetch(`${API_BASE()}/artifacts/transfer-requests?${params}`);
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || `HTTP ${response.status}`);
  }
  return response.json();
}

/**
 * Resolve (approve/reject) a transfer request
 */
export async function resolveTransferRequest(
  requestId: string,
  action: 'approve' | 'reject'
): Promise<TransferRequest> {
  const response = await authFetch(`${API_BASE()}/artifacts/transfer-requests/${requestId}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ action }),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || `HTTP ${response.status}`);
  }
  return response.json();
}

/**
 * Cancel a pending transfer request
 */
export async function cancelTransferRequest(requestId: string): Promise<TransferRequest> {
  const response = await authFetch(`${API_BASE()}/artifacts/transfer-requests/${requestId}/cancel`, {
    method: 'POST',
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || `HTTP ${response.status}`);
  }
  return response.json();
}

/**
 * Delete a completed transfer request from history (sender only)
 */
export async function deleteTransferRequest(requestId: string): Promise<{ success: boolean; id: string }> {
  const response = await authFetch(`${API_BASE()}/artifacts/transfer-requests/${requestId}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || `HTTP ${response.status}`);
  }
  return response.json();
}

/**
 * Download a file or directory
 */
export function getDownloadUrl(projectId: string, featureName: string, filePath: string): string {
  return `${API_BASE()}/projects/${encodeURIComponent(projectId)}/features/${encodeURIComponent(featureName)}/download?path=${encodeURIComponent(filePath)}`;
}

// ============================================================================
// Organization API
// ============================================================================

// ---- Org Config ----

export interface OrgConfig {
  github?: {
    /** Default GitHub owner (user or organization) for new projects */
    owner?: string;
  };
}

/**
 * Fetch organization-level configuration
 */
export async function fetchOrgConfig(): Promise<OrgConfig> {
  try {
    const response = await authFetch(`${API_BASE()}/org/config`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json();
  } catch (error: any) {
    console.error('Error fetching org config:', error);
    return {};
  }
}

/**
 * Update organization-level configuration (deep merge)
 */
export async function updateOrgConfig(config: Partial<OrgConfig>): Promise<OrgConfig> {
  const response = await authFetch(`${API_BASE()}/org/config`, {
    method: 'PUT',
    body: JSON.stringify(config),
  });
  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || `HTTP ${response.status}`);
  }
  return response.json();
}

// ---- User Config (per-user overrides) ----

export interface UserConfig {
  github?: {
    /** User-level override for default GitHub owner. Takes precedence over org config. null = clear override. */
    ownerOverride?: string | null;
  };
}

/**
 * Fetch user-level configuration (personal overrides)
 */
export async function fetchUserConfig(): Promise<UserConfig> {
  try {
    const response = await authFetch(`${API_BASE()}/user/config`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json();
  } catch (error: any) {
    console.error('Error fetching user config:', error);
    return {};
  }
}

/**
 * Update user-level configuration (deep merge)
 */
export async function updateUserConfig(config: Partial<UserConfig>): Promise<UserConfig> {
  const response = await authFetch(`${API_BASE()}/user/config`, {
    method: 'PUT',
    body: JSON.stringify(config),
  });
  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || `HTTP ${response.status}`);
  }
  return response.json();
}

/**
 * Reset user account: delete all workspaces, sessions, and user config.
 * Git repositories are preserved.
 */
export async function resetUserAccount(): Promise<{ success: boolean; message?: string; error?: string }> {
  try {
    const response = await authFetch(`${API_BASE()}/user/reset`, {
      method: 'POST',
    });
    
    const result = await response.json();
    
    if (!response.ok) {
      return {
        success: false,
        error: result.error || `HTTP ${response.status}`
      };
    }
    
    return { success: true, message: result.message };
  } catch (error: any) {
    console.error('Error resetting user account:', error);
    return {
      success: false,
      error: error.message || 'Network error'
    };
  }
}

// ---- Org Members ----

export async function fetchOrgMembers(): Promise<{ members: Array<{ userId: string; isSelf: boolean }> }> {
  const response = await authFetch(`${API_BASE()}/org/members`);
  if (!response.ok) throw new Error('Failed to fetch org members');
  return response.json();
}

export async function fetchMemberProjects(userId: string): Promise<{ projects: Array<{ projectId: string }> }> {
  const response = await authFetch(`${API_BASE()}/org/members/${userId}/projects`);
  if (!response.ok) throw new Error('Failed to fetch member projects');
  return response.json();
}

export async function fetchMemberFeatures(
  userId: string,
  projectId: string
): Promise<{ features: Array<{ featureId: string }> }> {
  const response = await authFetch(`${API_BASE()}/org/members/${userId}/projects/${projectId}/features`);
  if (!response.ok) throw new Error('Failed to fetch member features');
  return response.json();
}

export async function fetchMemberDirectories(
  userId: string,
  projectId: string,
  featureId: string
): Promise<{ directories: string[] }> {
  const response = await authFetch(
    `${API_BASE()}/org/members/${userId}/projects/${projectId}/features/${featureId}/directories`
  );
  if (!response.ok) throw new Error('Failed to fetch directories');
  return response.json();
}

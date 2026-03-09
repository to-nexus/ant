/// <reference types="vite/client" />

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
  return 'cloud';
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
 * - local mode: relative paths (Vite proxy routes to each service)
 * - cloud mode: VITE_CLOUD_BACKEND_BASE env var
 */
const getBackendBase = (): string => {
  const mode = getBackendMode();

  if (mode === 'cloud') {
    const cloudBase = import.meta.env.VITE_CLOUD_BACKEND_BASE;
    if (!cloudBase) {
      console.warn('[API] VITE_CLOUD_BACKEND_BASE not set, using relative paths');
      return '';
    }
    return cloudBase;
  }

  return '';
};

/** API Server base URL (/api/*) */
export const API_BASE = () => `${getBackendBase()}/api`;

/** Realtime (SSE) Server base URL (/realtime/*) */
export const REALTIME_BASE = () => `${getBackendBase()}/realtime`;

/** Preview Server base URL (separate host) */
export const getPreviewBase = (): string => {
  const previewHost = import.meta.env.VITE_PREVIEW_HOST;
  if (previewHost) return previewHost;
  return 'http://localhost:4102';
};

export const PREVIEW_BASE = () => getPreviewBase();

/** Server base URL without path prefix (for /ide/* etc.) */
export const SERVER_BASE = () => getBackendBase();

/**
 * Check if backend server is available
 */
export async function checkLocalBackend(): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE()}/health`, {
      method: 'GET',
      credentials: 'include',
      signal: AbortSignal.timeout(3000),
    });
    return response.ok;
  } catch {
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
 * Authenticated fetch wrapper.
 * 
 * Authentication is handled via httpOnly JWT cookies (credentials: 'include').
 * No custom auth headers are needed — the browser automatically sends the
 * ant_session cookie with every cross-origin request.
 */
export async function authFetch(url: string, options?: RequestInit): Promise<Response> {
  const isFormDataBody =
    typeof FormData !== 'undefined' && options?.body instanceof FormData;

  const baseHeaders: Record<string, string> = {};
  if (!isFormDataBody) {
    baseHeaders['Content-Type'] = 'application/json';
  }

  const headers = {
    ...baseHeaders,
    ...(options?.headers || {}),
  } as HeadersInit;

  return fetch(url, {
    ...options,
    headers,
    credentials: 'include',
  });
}

// ── Generic API helpers ─────────────────────────────────────────────
// These absorb the repetitive try/catch + authFetch + response.ok pattern.

export async function apiGet<T>(url: string): Promise<T> {
  const response = await authFetch(url);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error((body as any).error || (body as any).message || `HTTP ${response.status}`);
  }
  return response.json();
}

export async function apiPost<T = void>(url: string, body?: unknown): Promise<T> {
  const response = await authFetch(url, {
    method: 'POST',
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error((err as any).error || (err as any).message || `HTTP ${response.status}`);
  }
  return response.json().catch(() => undefined as T);
}

export async function apiPut<T = void>(url: string, body: unknown): Promise<T> {
  const response = await authFetch(url, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error((err as any).error || (err as any).message || `HTTP ${response.status}`);
  }
  return response.json().catch(() => undefined as T);
}

export async function apiPatch<T = void>(url: string, body: unknown): Promise<T> {
  const response = await authFetch(url, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error((err as any).error || (err as any).message || `HTTP ${response.status}`);
  }
  return response.json().catch(() => undefined as T);
}

export async function apiDelete<T = void>(url: string, body?: unknown): Promise<T> {
  const response = await authFetch(url, {
    method: 'DELETE',
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error((err as any).error || (err as any).message || `HTTP ${response.status}`);
  }
  return response.json().catch(() => undefined as T);
}

/// <reference types="vite/client" />

const DEFAULT_LOCAL_BACKEND_PORT = 4100;
const STORAGE_KEY_LOCAL_BACKEND_PORT = 'ant-ui:local-backend-port';

/**
 * Local backend port — dev convenience only. Read from localStorage so the
 * Account Configuration panel can override the default 4100 when a user
 * runs `pnpm dev:api-server` on a different port. Has no effect when
 * `VITE_CLOUD_BACKEND_BASE` is set (cloud builds reach the BE by URL).
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
 * Backend base URL. Build-time decision: `VITE_CLOUD_BACKEND_BASE` is the
 * single source of truth for "where is the BE." When set, all API/Realtime
 * traffic goes there. When unset, paths are relative (Vite proxy in dev,
 * same-origin in single-host deploy).
 *
 * The BE's runtime mode (`ANT_SERVER_MODE`) is orthogonal — it's exposed
 * via `GET /system/config` (see `configSlice.serverMode`) and only affects
 * how the FE renders auth / mode label, not which BE it talks to.
 */
const getBackendBase = (): string => {
  const cloudBase = import.meta.env.VITE_CLOUD_BACKEND_BASE as string | undefined;
  return cloudBase ?? '';
};

/** API Server base URL (/api/*) */
export const API_BASE = () => `${getBackendBase()}/api`;

/** Realtime (SSE) Server base URL (/realtime/*) */
export const REALTIME_BASE = () => `${getBackendBase()}/realtime`;

/**
 * Preview Server base URL.
 *
 * Empty string is treated as "same-origin" (single-host deployment).
 * Only fall back to `localhost:4102` when the env was never declared and
 * we are in dev — otherwise return same-origin so production builds with
 * `VITE_PREVIEW_HOST=` (empty) don't accidentally hit localhost.
 */
export const getPreviewBase = (): string => {
  const previewHost = import.meta.env.VITE_PREVIEW_HOST as string | undefined;
  if (previewHost !== undefined) return previewHost;
  return import.meta.env.DEV ? 'http://localhost:4102' : '';
};

export const PREVIEW_BASE = () => getPreviewBase();

/** Server base URL without path prefix (for /ide/* etc.) */
export const SERVER_BASE = () => getBackendBase();

/**
 * OAuth base URL. When `VITE_CLOUD_BACKEND_BASE` is set (cloud build), the
 * OAuth callback origin matches that base. Otherwise (local dev) the
 * callback must hit `http://localhost:{port}` directly so the Google
 * `redirect_uri` (registered as `http://localhost:{port}/api/auth/google/callback`)
 * matches the origin Google calls back — bypassing the Vite dev proxy.
 */
export const OAUTH_BASE = (): string => {
  const cloudBase = import.meta.env.VITE_CLOUD_BACKEND_BASE as string | undefined;
  if (cloudBase) return cloudBase;
  return `http://localhost:${getLocalBackendPort()}`;
};

if (import.meta.env.DEV) {
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

/**
 * 401 interceptor — single sink for stale-session detection on protected
 * requests. Called by all `apiGet/Post/Put/Patch/Delete` helpers; **skipped
 * for `/auth/me`** (which returns 200+null by contract — a 401 there would
 * be a backend bug, not a stale session) and **for cross-host URLs** (a
 * 401 from `ant-preview` / `ant-realtime` means that host can't see the
 * cookie or rejected the JWT, not that the API session is dead — see
 * `isApiHostUrl`).
 *
 * On 401:
 *   1. mark session-expired (suppresses SSE auto-reconnect)
 *   2. broadcast `session-expired` (other tabs react)
 *   3. cascade `clearUser()` on the auth slice
 *
 * Re-throws ApiError as usual so the calling code can decide whether to
 * surface its own message — auto-redirect to OAuth is intentionally NOT
 * performed (avoids loops on misconfig; the user clicks Sign In manually).
 */
function isAuthMeUrl(url: string): boolean {
  return url.endsWith('/auth/me') || url.includes('/auth/me?');
}

/**
 * Scopes the 401 cascade to API-host URLs. A 401 from `ant-preview` or
 * `ant-realtime` means that host can't authenticate the request (cookie
 * scope, pod restart race, etc.) — it doesn't imply the API session is
 * dead, so we don't tear down the user.
 *
 * Relative URLs are always API-bound (Vite proxy / same-origin deploy).
 */
function isApiHostUrl(url: string): boolean {
  if (!/^https?:\/\//i.test(url)) return true;
  try {
    const apiOrigin = new URL(API_BASE(), window.location.origin).origin;
    return new URL(url).origin === apiOrigin;
  } catch {
    return true; // fail-safe: behave like before
  }
}

let session401Cascading = false;

async function handle401Cascade(url: string): Promise<void> {
  if (isAuthMeUrl(url)) return;
  if (!isApiHostUrl(url)) return;
  if (session401Cascading) return;
  session401Cascading = true;
  try {
    const [{ getAuthBroadcaster, markSessionExpired }, { useStore }] = await Promise.all([
      import('@/infrastructure/auth/authBridge'),
      import('@/domain/store'),
    ]);
    markSessionExpired();
    try {
      getAuthBroadcaster().post({ type: 'session-expired', at: Date.now() });
    } catch (err) {
      console.error('[Auth] 401 broadcast failed', err);
    }
    const state = useStore.getState() as any;
    if (typeof state.clearUser === 'function') {
      state.clearUser();
    }
  } finally {
    // Reset on the next tick so a burst of in-flight 401s doesn't trigger
    // multiple cascades but a later genuine 401 (after re-login) still does.
    setTimeout(() => {
      session401Cascading = false;
    }, 1000);
  }
}

// ── Generic API helpers ─────────────────────────────────────────────
// These absorb the repetitive try/catch + authFetch + response.ok pattern.

/**
 * Structured API error that carries the HTTP status code and optional
 * machine-readable `code` / `allowed` fields from the response body.
 * Useful for policy validation errors (HTTP 422).
 */
export class ApiError extends Error {
  status: number;
  code?: string;
  allowed?: string[];
  /** True when the server signaled that retrying with `?force=true` will succeed
   *  (e.g. 409 Project already exists with stale leftover state). */
  canForceCleanup?: boolean;
  /** Optional human-readable hint from the server (paired with canForceCleanup). */
  hint?: string;

  constructor(message: string, status: number, data?: Record<string, unknown>) {
    super(message);
    // Fixes instanceof checks when transpiled to ES5 (TypeScript extends Error).
    Object.setPrototypeOf(this, ApiError.prototype);
    this.name = 'ApiError';
    this.status = status;
    this.code = data?.code as string | undefined;
    this.allowed = data?.allowed as string[] | undefined;
    this.canForceCleanup = data?.canForceCleanup as boolean | undefined;
    this.hint = data?.hint as string | undefined;
  }
}

function throwApiError(status: number, body: Record<string, unknown>): never {
  const message = (body.error as string) || (body.message as string) || `HTTP ${status}`;
  throw new ApiError(message, status, body);
}

export async function apiGet<T>(url: string): Promise<T> {
  const response = await authFetch(url);
  if (!response.ok) {
    if (response.status === 401) await handle401Cascade(url);
    const body = await response.json().catch(() => ({}));
    throwApiError(response.status, body);
  }
  return response.json();
}

export async function apiPost<T = void>(url: string, body?: unknown): Promise<T> {
  const response = await authFetch(url, {
    method: 'POST',
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    if (response.status === 401) await handle401Cascade(url);
    const err = await response.json().catch(() => ({}));
    throwApiError(response.status, err);
  }
  return response.json().catch(() => undefined as T);
}

export async function apiPut<T = void>(url: string, body: unknown): Promise<T> {
  const response = await authFetch(url, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    if (response.status === 401) await handle401Cascade(url);
    const err = await response.json().catch(() => ({}));
    throwApiError(response.status, err);
  }
  return response.json().catch(() => undefined as T);
}

export async function apiPatch<T = void>(url: string, body: unknown): Promise<T> {
  const response = await authFetch(url, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    if (response.status === 401) await handle401Cascade(url);
    const err = await response.json().catch(() => ({}));
    throwApiError(response.status, err);
  }
  return response.json().catch(() => undefined as T);
}

export async function apiDelete<T = void>(url: string, body?: unknown): Promise<T> {
  const response = await authFetch(url, {
    method: 'DELETE',
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    if (response.status === 401) await handle401Cascade(url);
    const err = await response.json().catch(() => ({}));
    throwApiError(response.status, err);
  }
  return response.json().catch(() => undefined as T);
}

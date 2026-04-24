/**
 * git-world private REST client.
 *
 * **ESLint enforced**: No file outside `src/domain/git-world/**` may import
 * from this module. The sole public writer surface is
 * `git-world/actions.ts` (which re-exports `runGitOperation` / `savePat` /
 * `deletePat`). All other consumers must use the `git-world` public index.
 *
 * Greenfield REST surface (replaces the 10-endpoint legacy surface):
 * - `GET  /projects/:id/git/state?feature=…&fresh=…` → `GitStateResponse`
 * - `POST /projects/:id/git/ops/:userOp`             → `{ success, result? | error }`
 * - `GET  /github/pat/status`                         → `GitPatState`
 * - `POST /github/pat`                                → `{ success }`
 * - `DELETE /github/pat`                              → `{ success }`
 */

import type {
  GitSnapshot,
  GitPatState,
  GitStateResponse,
  GitUserOperation,
  GitOperationError as GitOperationErrorShape,
  GitUserOperationKind,
} from '@ant/shared';
import { API_BASE, apiGet, authFetch } from '../../../infrastructure/http/api/client';

export interface DispatchGitOpSuccess<TResult = unknown> {
  success: true;
  result?: TResult;
}

export interface DispatchGitOpFailure {
  success: false;
  error: GitOperationErrorShape;
}

export type DispatchGitOpResponse<TResult = unknown> =
  | DispatchGitOpSuccess<TResult>
  | DispatchGitOpFailure;

/**
 * Fetch the canonical Git snapshot + PAT state for a (project, feature).
 *
 * `fresh=true` bypasses the `remoteExists` probe cache so a freshly-opened
 * Setup menu sees an authoritative result.
 */
export async function fetchGitState(
  projectId: string,
  opts: { feature?: string; fresh?: boolean } = {},
): Promise<{ snapshot: GitSnapshot; pat: GitPatState }> {
  const params = new URLSearchParams();
  if (opts.feature) params.set('feature', opts.feature);
  if (opts.fresh) params.set('fresh', 'true');
  const qs = params.toString();
  const url = `${API_BASE()}/projects/${encodeURIComponent(projectId)}/git/state${qs ? `?${qs}` : ''}`;
  const resp = await apiGet<GitStateResponse>(url);
  return { snapshot: resp.snapshot, pat: resp.pat };
}

/**
 * Dispatch a user-initiated Git operation through the unified endpoint.
 *
 * The caller passes the fully-discriminated `GitUserOperation` — this
 * function extracts `kind` for the URL and sends the rest as the body.
 * The BE's `GitOperation.onSuccess` hook subsequently publishes a
 * `gitState` SSE event (cause='operationComplete') which refreshes the
 * snapshot; callers should *not* re-fetch state manually.
 */
export async function dispatchGitOp<TResult = unknown>(
  projectId: string,
  op: GitUserOperation,
): Promise<DispatchGitOpResponse<TResult>> {
  const { kind, ...body } = op as { kind: GitUserOperationKind } & Record<string, unknown>;
  const url = `${API_BASE()}/projects/${encodeURIComponent(projectId)}/git/ops/${encodeURIComponent(kind)}`;

  const response = await authFetch(url, {
    method: 'POST',
    body: JSON.stringify(body),
  });

  const text = await response.text();
  let parsed: any;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = { success: false, error: { kind: 'unknown', message: text || `HTTP ${response.status}`, retryable: true, suggestedAction: null } };
  }

  if (response.ok && parsed.success === true) {
    return { success: true, result: parsed.result };
  }

  const errShape: GitOperationErrorShape =
    parsed.error && typeof parsed.error === 'object'
      ? {
          kind: parsed.error.kind ?? 'unknown',
          message: parsed.error.message ?? `HTTP ${response.status}`,
          retryable: parsed.error.retryable ?? false,
          suggestedAction: parsed.error.suggestedAction ?? null,
        }
      : {
          kind: 'unknown',
          message: `HTTP ${response.status}`,
          retryable: response.status >= 500,
          suggestedAction: null,
        };

  return { success: false, error: errShape };
}

// ── PAT Management (greenfield surface) ──────────────────────────────

export async function fetchPatState(): Promise<GitPatState> {
  try {
    return await apiGet<GitPatState>(`${API_BASE()}/github/pat/status`);
  } catch {
    return { configured: false };
  }
}

export async function savePat(pat: string): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await authFetch(`${API_BASE()}/github/pat`, {
      method: 'POST',
      body: JSON.stringify({ pat }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return { success: false, error: data.error || `HTTP ${response.status}` };
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function deletePat(): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await authFetch(`${API_BASE()}/github/pat`, { method: 'DELETE' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return { success: false, error: data.error || `HTTP ${response.status}` };
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

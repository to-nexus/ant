import { API_BASE, authFetch, apiGet } from './client';

export interface GitHubPATStatus {
  configured: boolean;
  message: string;
  username?: string;
}

export interface SavePATResult {
  success: boolean;
  username?: string;
  error?: string;
  message?: string;
}

// ── Internal helper for GitHub operations with { success, error? } pattern ──

async function gitAction(
  url: string,
  method: string = 'POST',
  body?: unknown,
): Promise<{ success: boolean; error?: string; warnings?: string[] }> {
  try {
    const response = await authFetch(url, {
      method,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const result = await response.json();
    if (!response.ok) return { success: false, error: result.error || `HTTP ${response.status}` };
    return { success: true, warnings: result.warnings };
  } catch (error: any) {
    return { success: false, error: error.message || 'Network error' };
  }
}

// ── Streaming variant for long-running operations (clone, initialize) ──
// Server sends keep-alive space bytes every 15s to prevent proxy idle timeout,
// then ends with the final JSON result.
async function streamingGitAction(
  url: string,
  body?: unknown,
): Promise<{ success: boolean; error?: string; warnings?: string[] }> {
  try {
    console.log('[git] streamingGitAction: start', url);
    const response = await authFetch(url, {
      method: 'POST',
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await response.text();
    console.log('[git] streamingGitAction: raw', JSON.stringify(text));
    const result = JSON.parse(text.trim());
    console.log('[git] streamingGitAction: parsed', result);
    return result;
  } catch (error: any) {
    console.error('[git] streamingGitAction: error', error);
    return { success: false, error: error.message || 'Network error' };
  }
}

// ── PAT Management ──────────────────────────────────────────────────

export function checkGitHubPATStatus(): Promise<GitHubPATStatus> {
  return apiGet<GitHubPATStatus>(`${API_BASE()}/github/pat/status`).catch(() => ({
    configured: false,
    message: 'Failed to check PAT status',
  }));
}

export async function saveGitHubPAT(pat: string): Promise<SavePATResult> {
  try {
    const response = await authFetch(`${API_BASE()}/github/pat`, {
      method: 'POST',
      body: JSON.stringify({ pat }),
    });
    const text = await response.text();
    const result = text ? JSON.parse(text) : {};
    if (!response.ok) return { success: false, error: result.error || `HTTP ${response.status}` };
    return { success: true, ...result };
  } catch (error: any) {
    return { success: false, error: error.message || 'Network error' };
  }
}

export async function deleteGitHubPAT(): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await authFetch(`${API_BASE()}/github/pat`, { method: 'DELETE' });
    if (!response.ok) {
      const result = await response.json();
      return { success: false, error: result.error || `HTTP ${response.status}` };
    }
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message || 'Network error' };
  }
}

// ── Repository Operations ───────────────────────────────────────────

export function cloneGitHubRepo(projectId: string) {
  return streamingGitAction(`${API_BASE()}/projects/${encodeURIComponent(projectId)}/clone`);
}

export async function checkCloneStatus(
  projectId: string,
): Promise<{ cloned: boolean; error?: string }> {
  try {
    const result = await apiGet<{ cloned: boolean }>(
      `${API_BASE()}/projects/${encodeURIComponent(projectId)}/clone/status`,
    );
    return { cloned: result.cloned };
  } catch (error: any) {
    return { cloned: false, error: error.message || 'Network error' };
  }
}

export function initializeGitHubRepo(projectId: string, activeFeature?: string) {
  return streamingGitAction(
    `${API_BASE()}/projects/${encodeURIComponent(projectId)}/initialize`,
    activeFeature ? { activeFeature } : undefined,
  );
}

export function pushToGitHub(projectId: string, feature?: string) {
  return gitAction(
    `${API_BASE()}/projects/${encodeURIComponent(projectId)}/push`,
    'POST',
    feature ? { feature } : undefined,
  );
}

export function pullFromGitHub(projectId: string, feature?: string) {
  return gitAction(
    `${API_BASE()}/projects/${encodeURIComponent(projectId)}/pull`,
    'POST',
    feature ? { feature } : undefined,
  );
}

export function fetchFromGitHub(projectId: string, feature?: string) {
  return gitAction(
    `${API_BASE()}/projects/${encodeURIComponent(projectId)}/fetch`,
    'POST',
    { feature },
  );
}

// ── Git Status & Operations ─────────────────────────────────────────

export function getGitStatus(projectId: string, feature?: string): Promise<{
  hasGit: boolean;
  hasCodebase: boolean;
  hasFeatures: boolean;
  currentBranch?: string;
  remoteUrl?: string;
}> {
  const params = feature ? `?feature=${encodeURIComponent(feature)}` : '';
  return apiGet<{
    hasGit: boolean;
    hasCodebase: boolean;
    hasFeatures: boolean;
    currentBranch?: string;
    remoteUrl?: string;
  }>(`${API_BASE()}/projects/${encodeURIComponent(projectId)}/git/status${params}`).catch(() => ({
    hasGit: false,
    hasCodebase: false,
    hasFeatures: false,
  }));
}

export interface FileChange {
  path: string;
  status: 'modified' | 'deleted' | 'new' | 'renamed';
}

export function getGitChanges(projectId: string, feature?: string): Promise<{
  hasChanges: boolean;
  staged: FileChange[];
  unstaged: FileChange[];
  untracked: FileChange[];
  ahead: number;
  behind: number;
  currentBranch?: string;
  isGitInitialized?: boolean;
  hasUpstream?: boolean;
}> {
  const params = feature ? `?feature=${encodeURIComponent(feature)}` : '';
  return apiGet(`${API_BASE()}/projects/${encodeURIComponent(projectId)}/git/changes${params}`);
}

export async function commitGitChanges(
  projectId: string,
  message?: string,
  feature?: string,
  files?: string[],
): Promise<{ success: boolean; commitHash?: string; error?: string }> {
  const response = await authFetch(
    `${API_BASE()}/projects/${encodeURIComponent(projectId)}/git/commit`,
    { method: 'POST', body: JSON.stringify({ message, feature, files }) },
  );
  const result = await response.json();
  if (!response.ok) return { success: false, error: result.error || `HTTP ${response.status}` };
  return result;
}

export async function discardGitChanges(
  projectId: string,
  feature?: string,
  files?: string[],
): Promise<{ success: boolean; discardedFiles?: number; error?: string }> {
  const response = await authFetch(
    `${API_BASE()}/projects/${encodeURIComponent(projectId)}/git/discard`,
    { method: 'POST', body: JSON.stringify({ feature, files }) },
  );
  const result = await response.json();
  if (!response.ok) return { success: false, error: result.error || `HTTP ${response.status}` };
  return result;
}

export async function syncWithRemote(projectId: string, feature?: string): Promise<{
  success: boolean;
  pulledChanges?: boolean;
  pushedChanges?: boolean;
  error?: string;
}> {
  const response = await authFetch(
    `${API_BASE()}/projects/${encodeURIComponent(projectId)}/git/sync`,
    { method: 'POST', body: JSON.stringify(feature ? { feature } : {}) },
  );
  const result = await response.json();
  if (!response.ok) return { success: false, error: result.error || `HTTP ${response.status}` };
  return result;
}

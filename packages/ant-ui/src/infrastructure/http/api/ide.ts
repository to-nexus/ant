import { API_BASE, authFetch } from './client';

export const RESERVED_FEATURE_NAME = '_base';

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

export interface CloudIDEInstance {
  url: string;
  directUrl?: string;
  port: number;
  status: string;
  workspacePath?: string;
}

export interface StartCloudIDEResponse {
  success: boolean;
  instance: CloudIDEInstance;
}

/** Open local IDE (Cursor or VS Code) */
export async function openLocalIDE(
  ide: 'cursor' | 'vscode',
  localPath: string,
): Promise<OpenIDEResponse> {
  const response = await authFetch(`${API_BASE()}/ide/open`, {
    method: 'POST',
    body: JSON.stringify({ ide, localPath }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || data.error || 'Failed to open IDE');
  return data;
}

/** Check if local IDE is installed */
export async function checkIDEInstalled(ide: 'cursor' | 'vscode'): Promise<CheckIDEResponse> {
  try {
    const response = await authFetch(`${API_BASE()}/ide/check/${ide}`);
    return await response.json();
  } catch (error: any) {
    return { ide, installed: false, path: null, error: error.message };
  }
}

/**
 * Start cloud IDE container for a project/feature.
 * Returns proxy URL for embedding.
 */
export async function startCloudIDE(
  projectId: string,
  featureName: string = RESERVED_FEATURE_NAME,
): Promise<StartCloudIDEResponse> {
  const response = await authFetch(`${API_BASE()}/cloud-ide/start`, {
    method: 'POST',
    body: JSON.stringify({ projectId, featureName }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error || data?.message || 'Failed to start cloud IDE');
  return data;
}

/**
 * Graceful stop — gracePeriod=5s. Used by the "Close IDE" action; idle reap
 * also calls the same endpoint after 10 minutes of inactivity.
 */
export async function stopCloudIDE(
  projectId: string,
  featureName: string = RESERVED_FEATURE_NAME,
): Promise<{ success: boolean; message?: string }> {
  const response = await authFetch(`${API_BASE()}/cloud-ide/stop`, {
    method: 'POST',
    body: JSON.stringify({ projectId, featureName }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error || data?.message || 'Failed to stop cloud IDE');
  return data;
}

/**
 * Force-reset — gracePeriod=0 + state-store cleanup verification. Used by the
 * "강제 초기화" (force reset) action when a startup is stuck. No auto-restart;
 * the FE drops to `idle` after success.
 */
export async function resetCloudIDE(
  projectId: string,
  featureName: string = RESERVED_FEATURE_NAME,
): Promise<{ success: boolean; cleared?: { pod: boolean; stateStore: boolean }; message?: string }> {
  const response = await authFetch(`${API_BASE()}/cloud-ide/reset`, {
    method: 'POST',
    body: JSON.stringify({ projectId, featureName }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error || data?.message || 'Failed to reset cloud IDE');
  return data;
}

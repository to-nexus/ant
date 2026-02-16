import { API_BASE, authFetch } from './client';

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
  featureName: string = 'main',
): Promise<StartCloudIDEResponse> {
  const response = await authFetch(`${API_BASE()}/cloud-ide/start`, {
    method: 'POST',
    body: JSON.stringify({ projectId, featureName }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error || data?.message || 'Failed to start cloud IDE');
  return data;
}

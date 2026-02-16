import { API_BASE, authFetch, getBackendMode, apiGet } from './client';

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

export function checkFigmaConfigStatus(): Promise<FigmaConfigStatus> {
  return apiGet<FigmaConfigStatus>(`${API_BASE()}/figma/config`).catch(() => ({
    configured: false,
  }));
}

/**
 * Start Figma OAuth flow. Opens OAuth popup window.
 */
export async function startFigmaOAuth(): Promise<void> {
  const backendMode = getBackendMode();
  let userEmail = 'local@local';

  if (backendMode === 'cloud') {
    const stored = localStorage.getItem('ant-ui:user-email');
    if (stored) {
      userEmail = JSON.parse(stored);
    } else {
      throw new Error('User email not found. Please log in again.');
    }
  }

  const authUrl = `${API_BASE()}/figma/oauth/authorize?user-email=${encodeURIComponent(userEmail)}`;
  const width = 600;
  const height = 700;
  const left = (window.screen.width - width) / 2;
  const top = (window.screen.height - height) / 2;

  window.open(authUrl, 'FigmaOAuth', `width=${width},height=${height},left=${left},top=${top}`);
}

export async function disconnectFigma(): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await authFetch(`${API_BASE()}/figma/oauth/disconnect`, { method: 'POST' });
    if (!response.ok) {
      const result = await response.json();
      return { success: false, error: result.error || `HTTP ${response.status}` };
    }
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message || 'Network error' };
  }
}

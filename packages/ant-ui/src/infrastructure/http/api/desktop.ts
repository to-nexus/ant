import { API_BASE, authFetch, apiGet, getBackendMode } from './client';

export interface DesktopTokenResponse {
  success: boolean;
  token?: string;
  expiresInDays?: number;
}

export async function requestDesktopToken(): Promise<DesktopTokenResponse> {
  try {
    const response = await authFetch(`${API_BASE()}/auth/desktop-token`, { method: 'POST' });
    if (!response.ok) {
      return { success: false };
    }
    return await response.json();
  } catch {
    return { success: false };
  }
}

/**
 * Build the Realtime Server URL that Ant Desktop should connect to.
 *
 * Ant Desktop is a desktop process, so it connects directly — it
 * cannot go through the Vite dev proxy.  In local-dev (hostname is
 * localhost / 127.0.0.1) we always return the direct Realtime Server
 * address.  In production cloud the origin already points at the load
 * balancer which routes /bridge/ws correctly.
 */
export function getRealtimeServerUrl(): string {
  const hostname = window.location.hostname;
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return 'http://127.0.0.1:4101';
  }
  return window.location.origin;
}

/**
 * Open Ant Desktop via deep link.
 * Returns true if a deep link was triggered, false if token generation failed.
 */
export async function openDesktopDeepLink(): Promise<boolean> {
  const result = await requestDesktopToken();
  if (!result.success || !result.token) {
    return false;
  }
  const serverUrl = getRealtimeServerUrl();
  const deepLink = `ant-desktop://connect?token=${encodeURIComponent(result.token)}&server=${encodeURIComponent(serverUrl)}`;
  window.location.href = deepLink;
  return true;
}

export interface BridgeStatus {
  connected: boolean;
  detected: boolean;
  session?: {
    userId: string;
    status: string;
    figmaDesktopReachable: boolean;
    lastPingAt: number;
  };
  figmaDesktopReachable?: boolean;
}

export async function checkBridgeStatus(): Promise<BridgeStatus> {
  return apiGet<BridgeStatus>(`${API_BASE()}/bridge/status`).catch(() => ({
    connected: false,
    detected: false,
  }));
}

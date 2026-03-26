import { API_BASE, authFetch, apiGet } from './client';
import type { FigmaDataConfig } from '@ant/shared';

export async function getFigmaConfig(projectId: string, featureName: string): Promise<FigmaDataConfig | null> {
  try {
    const result = await apiGet<{ success: boolean; config: FigmaDataConfig }>(
      `${API_BASE()}/figma/config/${projectId}/${featureName}`
    );
    return result.config || null;
  } catch {
    return null;
  }
}

export async function saveFigmaConfig(
  projectId: string,
  featureName: string,
  config: FigmaDataConfig
): Promise<boolean> {
  try {
    const response = await authFetch(
      `${API_BASE()}/figma/config/${projectId}/${featureName}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      }
    );
    return response.ok;
  } catch {
    return false;
  }
}

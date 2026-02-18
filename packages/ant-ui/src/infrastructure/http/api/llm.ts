import { API_BASE, apiGet } from './client';

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

/**
 * Health check to verify API connection.
 * Uses plain fetch (not authFetch) because it may be called before authentication.
 */
export async function checkHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE()}/health`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!response.ok) return false;
    const data = await response.json();
    return data.status === 'ok';
  } catch {
    return false;
  }
}

export function fetchAvailableModels(): Promise<AvailableModelsResponse> {
  return apiGet<AvailableModelsResponse>(`${API_BASE()}/models`).catch(() => ({
    models: [],
    default: 'claude-sonnet-4-6',
  }));
}

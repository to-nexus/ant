import { DEFAULT_MODELS, type ModelProvider, type ModelPricingEntry } from '@ant/shared';
import { API_BASE, apiGet } from './client';

export interface LLMModelInfo {
  id: string;
  displayName: string;
  provider: ModelProvider;
  description?: string;
  recommended?: boolean;
  capabilities?: string[];
}

export interface AvailableModelsResponse {
  models: LLMModelInfo[];
  default: string;
  /** Providers whose API key is configured on the server. A model whose
   * provider is absent here gets a "no API key" warning in the picker. Absent
   * (older server) → treat as "all configured" (no warnings). */
  configuredProviders?: ModelProvider[];
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
    // Mirror the BE /models default (DEFAULT_MODELS SSOT) on fetch failure.
    default: DEFAULT_MODELS.opusTier,
    configuredProviders: undefined,
  }));
}

/** Per-model unit-price matrix (USD/MTok). Rows come from `GET /models/pricing`,
 * which serves the SAME `MODEL_RATE_CARD` SSOT used to charge — so the displayed
 * prices equal the amounts billed. */
export interface ModelPricingResponse {
  entries: ModelPricingEntry[];
  currency: string;
}

export function fetchModelPricing(): Promise<ModelPricingResponse> {
  return apiGet<ModelPricingResponse>(`${API_BASE()}/models/pricing`);
}

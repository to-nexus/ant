import { Router, Request, Response } from 'express';
import { MODEL_REGISTRY, PROVIDER_API_KEY_ENV, type ModelProvider } from '@ant/shared';
import { StaticModelPricingAdapter } from '../../pricing/StaticModelPricingAdapter';
import type { ModelPricingPort } from '../../../../core/ports/modelPricing';
import { getFallbackModel } from '../../../../core/config/defaultModels';

/**
 * Available LLM Models API
 *
 * Returns list of available models with display names and metadata
 */

export interface LLMModelInfo {
  id: string;                    // Model identifier (e.g., "claude-sonnet-5")
  displayName: string;           // Human-readable name (e.g., "Sonnet 5")
  provider: ModelProvider;
  description?: string;          // Brief description
  recommended?: boolean;         // Whether this is a recommended model
  capabilities?: string[];       // e.g., ["coding", "reasoning", "fast"]
}

/**
 * Providers whose API key env var (see PROVIDER_API_KEY_ENV SSOT) is set to a
 * non-empty value on THIS server. Computed per-request so a key added without a
 * restart is reflected. The picker warns on models whose provider is absent
 * here. In cloud mode all keys are platform-managed → the list is full → no
 * warning ever shows.
 */
export function getConfiguredProviders(): ModelProvider[] {
  return (Object.keys(PROVIDER_API_KEY_ENV) as ModelProvider[]).filter((provider) => {
    const key = process.env[PROVIDER_API_KEY_ENV[provider]];
    return !!key && key.trim().length > 0;
  });
}

// Available models — DERIVED from the MODEL_REGISTRY SSOT (@ant/shared/models.ts):
// every entry marked `selectable !== false`, in registry order. Add/hide a model
// there, not here, so this endpoint can never drift from the pricing/context SSOTs.
const AVAILABLE_MODELS: LLMModelInfo[] = Object.values(MODEL_REGISTRY)
  .filter((m) => m.selectable !== false)
  .map((m) => ({
    id: m.id,
    displayName: m.displayName,
    provider: m.provider,
    description: m.description,
    recommended: m.recommended,
    capabilities: m.capabilities,
  }));

/**
 * Create models routes
 */
export function createModelsRoutes(
  pricing: ModelPricingPort = new StaticModelPricingAdapter(),
): Router {
  const router = Router();

  /**
   * GET /models
   * Returns list of available models
   */
  router.get('/models', (req: Request, res: Response) => {
    try {
      res.json({
        models: AVAILABLE_MODELS,
        default: getFallbackModel(),
        configuredProviders: getConfiguredProviders(),
      });
    } catch (error) {
      console.error('[Models API] Error:', error);
      res.status(500).json({
        error: 'Failed to fetch available models',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * GET /models/pricing
   * Per-model unit-price matrix (USD/MTok) via the ModelPricingPort. Registered
   * BEFORE `/models/:modelId` so "pricing" is not captured as a model id.
   */
  router.get('/models/pricing', async (_req: Request, res: Response) => {
    try {
      const entries = await pricing.listModelRates();
      res.json({ entries, currency: 'USD' });
    } catch (error) {
      console.error('[Models API] Pricing error:', error);
      res.status(500).json({
        error: 'Failed to fetch model pricing',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * GET /models/:modelId
   * Returns detailed information about a specific model
   */
  router.get('/models/:modelId', (req: Request, res: Response) => {
    try {
      const { modelId } = req.params;
      const model = AVAILABLE_MODELS.find(m => m.id === modelId);
      
      if (!model) {
        return res.status(404).json({
          error: 'Model not found',
          modelId
        });
      }
      
      res.json(model);
    } catch (error) {
      console.error('[Models API] Error:', error);
      res.status(500).json({
        error: 'Failed to fetch model information',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });
  
  return router;
}

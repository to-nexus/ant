import { Router, Request, Response } from 'express';
import { MODEL_REGISTRY, DEFAULT_MODELS } from '@ant/shared';

/**
 * Available LLM Models API
 *
 * Returns list of available models with display names and metadata
 */

export interface LLMModelInfo {
  id: string;                    // Model identifier (e.g., "claude-sonnet-5")
  displayName: string;           // Human-readable name (e.g., "Sonnet 5")
  provider: 'anthropic' | 'openai' | 'google' | 'deepseek';
  description?: string;          // Brief description
  recommended?: boolean;         // Whether this is a recommended model
  capabilities?: string[];       // e.g., ["coding", "reasoning", "fast"]
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
export function createModelsRoutes(): Router {
  const router = Router();
  
  /**
   * GET /models
   * Returns list of available models
   */
  router.get('/models', (req: Request, res: Response) => {
    try {
      res.json({
        models: AVAILABLE_MODELS,
        default: DEFAULT_MODELS.opusTier
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

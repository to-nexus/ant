import { Router, Request, Response } from 'express';

/**
 * Available LLM Models API
 * 
 * Returns list of available models with display names and metadata
 */

export interface LLMModelInfo {
  id: string;                    // Model identifier (e.g., "claude-sonnet-4-20250929")
  displayName: string;           // Human-readable name (e.g., "CLAUDE SONNET 4")
  provider: 'anthropic' | 'openai' | 'google';
  description?: string;          // Brief description
  recommended?: boolean;         // Whether this is a recommended model
  capabilities?: string[];       // e.g., ["coding", "reasoning", "fast"]
}

// Available models registry
const AVAILABLE_MODELS: LLMModelInfo[] = [
  {
    id: 'claude-sonnet-4-6',
    displayName: 'Sonnet 4.6',
    provider: 'anthropic',
    description: 'Latest Claude Sonnet model, best for coding',
    recommended: true,
    capabilities: ['coding', 'reasoning', 'large-context']
  },
  {
    id: 'claude-opus-4-7',
    displayName: 'Opus 4.7',
    provider: 'anthropic',
    description: 'Most capable Claude model, best for complex reasoning',
    recommended: false,
    capabilities: ['coding', 'reasoning', 'large-context', 'complex-analysis']
  },
  {
    id: 'gemini-3.1-pro-preview',
    displayName: 'Gemini 3.1 Pro',
    provider: 'google',
    description: 'Advanced reasoning and prompt engineering for visual jobs',
    recommended: true,
    capabilities: ['reasoning', 'prompt-engineering']
  },
  {
    id: 'gemini-3-flash-preview',
    displayName: 'Gemini 3 Flash',
    provider: 'google',
    description: 'Fast classification and triage for visual jobs',
    recommended: false,
    capabilities: ['fast', 'classification']
  },
  {
    id: 'gemini-3-pro-image-preview',
    displayName: 'Gemini 3 Pro Image',
    provider: 'google',
    description: 'High-quality image generation for final renders',
    recommended: true,
    capabilities: ['image-generation', 'high-quality']
  },
  {
    id: 'gemini-3.1-flash-image-preview',
    displayName: 'Gemini 3.1 Flash Image',
    provider: 'google',
    description: 'Fast image generation for draft exploration',
    recommended: false,
    capabilities: ['image-generation', 'fast']
  },
];

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
        default: 'claude-opus-4-7'
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

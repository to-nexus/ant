/**
 * LLMClientFactory
 * 
 * Creates provider-specific LLM clients based on configuration.
 * Provider is auto-detected from model name (claude-* = anthropic, gpt-* = openai).
 */

import { LLMClient } from '../../../core/ports/llm';
import { ImageGenerationPort } from '../../../core/ports/imageGeneration';
import { AnthropicLLMClient } from './AnthropicLLMClient';
import { OpenAILLMClient } from './OpenAILLMClient';
import { GeminiLLMClient } from './GeminiLLMClient';
import { GeminiImageClient } from './GeminiImageClient';

export type ModelProvider = 'anthropic' | 'openai' | 'google';

interface LLMConfig {
  temperature?: number;
  maxTokens?: number;
  timeout?: number;
}

/**
 * Job/Node context for model selection
 */
export interface LLMContext {
  jobType: 'design' | 'code' | 'learn' | 'plan' | 'visual';
  nodeType?: 'decompose' | 'plan' | 'docGen' | 'execute' | 'tool' | 'validate' | 'learn' | 'detectEnvironment' | 'direct' | 'sketch' | 'render' | 'engrave';
}

/**
 * Detect provider from model name
 * - claude-* → anthropic
 * - gpt-* → openai
 */
export function detectProviderFromModel(modelName: string): ModelProvider {
  const normalized = modelName.toLowerCase();
  
  if (normalized.startsWith('claude')) {
    return 'anthropic';
  }
  
  if (normalized.startsWith('gpt') || normalized.startsWith('o1') || normalized.startsWith('o3')) {
    return 'openai';
  }
  
  if (normalized.startsWith('gemini')) {
    return 'google';
  }
  
  // Default to anthropic
  console.warn(`[LLM] Unknown model prefix: ${modelName}, defaulting to anthropic`);
  return 'anthropic';
}

/**
 * Resolve model name based on job/node context
 * Priority: 
 *   1. workspaceConfig.llmModels[job][node]
 *   2. workspaceConfig.llmModels[job].default
 *   3. env var (AI_MODEL_NAME)
 *   4. hardcoded default
 */
function resolveModelForContext(
  context: LLMContext | undefined,
  workspaceConfig: any
): string {
  const defaultModel = process.env.AI_MODEL_NAME || 'claude-sonnet-4-6';
  
  // If no context provided, use default
  if (!context) {
    return defaultModel;
  }
  
  const llmModels = workspaceConfig?.llmModels;
  
  // If no llmModels config, fall back to env var
  if (!llmModels) {
    return defaultModel;
  }
  
  // Get job-level config
  const jobConfig = llmModels[context.jobType];
  
  if (!jobConfig) {
    return defaultModel;
  }
  
  // Try node-specific model first
  if (context.nodeType && jobConfig[context.nodeType]) {
    return jobConfig[context.nodeType];
  }

  // Fall back to job default
  return jobConfig.default || defaultModel;
}

/**
 * Resolve temperature from environment variables
 */
function resolveTemperature(agentJob?: string): number {
  const prefix = agentJob ? `${agentJob.toUpperCase()}_` : '';
  const temp = process.env[`${prefix}MODEL_TEMPERATURE`] || process.env.AI_MODEL_TEMPERATURE;
  return temp ? parseFloat(temp) : 0.7;
}

/**
 * Resolve max tokens from environment variables
 */
function resolveMaxTokens(agentJob?: string, fallback = 16000): number {
  const prefix = agentJob ? `${agentJob.toUpperCase()}_` : '';
  const tokens = process.env[`${prefix}MODEL_MAX_TOKENS`];
  return tokens ? parseInt(tokens) : fallback;
}

/**
 * Create LLM client based on job/node context
 * Provider is auto-detected from model name
 */
export function createLLMClient(
  agentJob?: string,
  config?: LLMConfig,
  context?: LLMContext,
  workspaceConfig?: any
): LLMClient {
  // Resolve model name based on context
  const modelName = resolveModelForContext(context, workspaceConfig);
  
  // Auto-detect provider from model name
  const provider = detectProviderFromModel(modelName);
  
  const temperature = config?.temperature ?? resolveTemperature(agentJob);
  const maxTokens = config?.maxTokens ?? resolveMaxTokens(agentJob);
  const timeout = config?.timeout ?? 180000; // 3 minutes

  switch (provider) {
    case 'anthropic':
      return new AnthropicLLMClient(agentJob, {
        apiKey: process.env.ANTHROPIC_API_KEY,
        modelName,
        temperature,
        maxTokens,
      });
    
    case 'openai':
      return new OpenAILLMClient(agentJob, {
        apiKey: process.env.OPENAI_API_KEY,
        modelName,
        temperature,
        maxTokens,
        timeout,
      });
    
    case 'google':
      return new GeminiLLMClient(agentJob, {
        apiKey: process.env.GEMINI_API_KEY,
        modelName,
        temperature,
        maxTokens,
      });
    
    default:
      throw new Error(`Unsupported LLM provider: ${provider}`);
  }
}

/**
 * Create Image Generation client for visual job.
 * Uses Gemini Nano Banana models (gemini-*-image-preview).
 */
export function createImageGenerationClient(
  workspaceConfig?: any,
  modelNameOverride?: string
): ImageGenerationPort {
  const modelName = modelNameOverride
    || workspaceConfig?.llmModels?.visual?.sketch
    || 'gemini-3.1-flash-image-preview';

  return new GeminiImageClient({
    apiKey: process.env.GEMINI_API_KEY,
    modelName,
  });
}


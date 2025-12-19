/**
 * LLMClientFactory
 * 
 * Creates provider-specific LLM clients based on configuration.
 * Provider is auto-detected from model name (claude-* = anthropic, gpt-* = openai).
 */

import { LLMClient } from '../../../core/ports/llm';
import { AnthropicLLMClient } from './AnthropicLLMClient';
import { OpenAILLMClient } from './OpenAILLMClient';

export type ModelProvider = 'anthropic' | 'openai';

interface LLMConfig {
  llmProvider?: string;
  llmModel?: string;
  temperature?: number;
  maxTokens?: number;
  timeout?: number;
}

/**
 * Job/Node context for model selection
 */
export interface LLMContext {
  jobType: 'design' | 'code';
  nodeType?: 'decompose' | 'error' | 'final' | 'default';
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
  
  // Default to anthropic
  console.warn(`[LLM] Unknown model prefix: ${modelName}, defaulting to anthropic`);
  return 'anthropic';
}

/**
 * Resolve model name based on job/node context
 * Priority: workspaceConfig.llmModels > env var (AI_MODEL_NAME) > hardcoded defaults
 */
function resolveModelForContext(
  context: LLMContext | undefined,
  workspaceConfig: any
): string {
  const defaultModel = process.env.AI_MODEL_NAME || 'claude-sonnet-4-5-20250929';  // ✅ Latest default
  
  // If no context provided, use default
  if (!context) {
    return workspaceConfig?.llmModel || defaultModel;
  }
  
  const llmModels = workspaceConfig?.llmModels;
  
  // If no llmModels config, fall back to old config or env var
  if (!llmModels) {
    return workspaceConfig?.llmModel || defaultModel;
  }
  
  // Select model based on job and node type
  if (context.jobType === 'design') {
    if (context.nodeType === 'decompose') {
      return llmModels.designDecompose || llmModels.designDefault || defaultModel;
    }
    return llmModels.designDefault || defaultModel;
  }
  
  if (context.jobType === 'code') {
    if (context.nodeType === 'decompose') {
      return llmModels.codeDecompose || llmModels.codeDefault || defaultModel;
    }
    if (context.nodeType === 'error') {
      return llmModels.codeError || llmModels.codeDefault || defaultModel;
    }
    if (context.nodeType === 'final') {
      return llmModels.codeFinal || llmModels.codeDefault || defaultModel;
    }
    return llmModels.codeDefault || defaultModel;
  }
  
  return defaultModel;
}

/**
 * Resolve temperature from environment variables
 */
function resolveTemperature(agentType?: string): number {
  const prefix = agentType ? `${agentType.toUpperCase()}_` : '';
  const temp = process.env[`${prefix}MODEL_TEMPERATURE`] || process.env.AI_MODEL_TEMPERATURE;
  return temp ? parseFloat(temp) : 0.7;
}

/**
 * Resolve max tokens from environment variables
 */
function resolveMaxTokens(agentType?: string, fallback = 16000): number {
  const prefix = agentType ? `${agentType.toUpperCase()}_` : '';
  const tokens = process.env[`${prefix}MODEL_MAX_TOKENS`];
  return tokens ? parseInt(tokens) : fallback;
}

/**
 * Create LLM client based on job/node context
 * Provider is auto-detected from model name
 */
export function createLLMClient(
  agentType?: string,
  config?: LLMConfig,
  context?: LLMContext,
  workspaceConfig?: any
): LLMClient {
  // Resolve model name based on context
  const modelName = config?.llmModel || resolveModelForContext(context, workspaceConfig);
  
  // Auto-detect provider from model name
  const provider = config?.llmProvider 
    ? (config.llmProvider as ModelProvider)
    : detectProviderFromModel(modelName);
  
  const temperature = config?.temperature ?? resolveTemperature(agentType);
  const maxTokens = config?.maxTokens ?? resolveMaxTokens(agentType);
  const timeout = config?.timeout ?? 180000; // 3 minutes

  // Log with context info
  const contextStr = context 
    ? ` [${context.jobType}/${context.nodeType || 'default'}]`
    : '';
  console.log(`🤖 [LLM]${contextStr} ${provider}/${modelName}`);

  switch (provider) {
    case 'anthropic':
      return new AnthropicLLMClient(agentType, {
        apiKey: process.env.ANTHROPIC_API_KEY,
        modelName,
        temperature,
        maxTokens,
      });
    
    case 'openai':
      return new OpenAILLMClient(agentType, {
        apiKey: process.env.OPENAI_API_KEY,
        modelName,
        temperature,
        maxTokens,
        timeout,
      });
    
    default:
      throw new Error(`Unsupported LLM provider: ${provider}`);
  }
}


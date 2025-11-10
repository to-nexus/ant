/**
 * LLMClientFactory
 * 
 * Creates provider-specific LLM clients based on configuration.
 * Replaces GenericLLMClient with direct provider implementations.
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
 * Resolve provider from environment variables
 */
function resolveProvider(agentType?: string): ModelProvider {
  const prefix = agentType ? `${agentType.toUpperCase()}_` : '';
  const provider = (process.env[`${prefix}MODEL_PROVIDER`] as ModelProvider) 
    || (process.env.AI_MODEL_PROVIDER as ModelProvider) 
    || 'anthropic';  // Default to Anthropic
  
  return provider;
}

/**
 * Resolve model name from environment variables
 */
function resolveModelName(provider: ModelProvider, agentType?: string): string {
  const prefix = agentType ? `${agentType.toUpperCase()}_` : '';
  
  let modelName: string;
  if (provider === 'anthropic') {
    modelName = process.env[`${prefix}MODEL_NAME`] 
      || process.env.AI_MODEL_NAME 
      || 'claude-sonnet-4-20250514';
  } else {
    modelName = process.env[`${prefix}MODEL_NAME`] 
      || process.env.AI_MODEL_NAME 
      || 'gpt-4-turbo-preview';
  }
  
  return modelName;
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
 * Create LLM client based on provider configuration
 */
export function createLLMClient(
  agentType?: string,
  config?: LLMConfig
): LLMClient {
  // Priority: config > env vars
  const provider = (config?.llmProvider as ModelProvider) || resolveProvider(agentType);
  const modelName = config?.llmModel || resolveModelName(provider, agentType);
  const temperature = config?.temperature ?? resolveTemperature(agentType);
  const maxTokens = config?.maxTokens ?? resolveMaxTokens(agentType);
  const timeout = config?.timeout ?? 180000; // 3 minutes

  // Minimal logging - only provider and model
  console.log(`🤖 [LLM] ${provider}/${modelName}`);

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


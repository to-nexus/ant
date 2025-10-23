import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOpenAI } from "@langchain/openai";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";

export type ModelProvider = 'anthropic' | 'openai';
export type AgentType = 'architect' | 'planner' | 'reviewer' | 'doc';

export interface ModelConfig {
  provider: ModelProvider;
  modelName: string;
  temperature?: number;
  maxTokens?: number;
}

const DEFAULT_CONFIGS: Record<ModelProvider, Omit<ModelConfig, 'provider'>> = {
  anthropic: {
    modelName: "claude-3-haiku-20240307",
    temperature: 0.2,
    maxTokens: 4000
  },
  openai: {
    modelName: "gpt-4o",
    temperature: 0.2,
    maxTokens: 16000
  }
};

export interface ModelInfo {
  model: BaseChatModel;
  provider: ModelProvider;
  modelName: string;
  temperature: number;
  maxTokens: number;
}

export function createModel(agentType?: AgentType, config?: Partial<ModelConfig>): ModelInfo {
  // Agent별 환경 변수 확인 (예: ARCHITECT_MODEL_PROVIDER)
  const agentPrefix = agentType ? `${agentType.toUpperCase()}_` : '';
  
  const provider = config?.provider || 
    (process.env[`${agentPrefix}MODEL_PROVIDER`] as ModelProvider) ||
    (process.env.AI_MODEL_PROVIDER as ModelProvider)
    
  const defaults = DEFAULT_CONFIGS[provider];
  
  const finalConfig = {
    modelName: config?.modelName || 
      process.env[`${agentPrefix}MODEL_NAME`] ||
      process.env.AI_MODEL_NAME || 
      defaults.modelName,
    temperature: config?.temperature ?? 
      (process.env[`${agentPrefix}MODEL_TEMPERATURE`] ? parseFloat(process.env[`${agentPrefix}MODEL_TEMPERATURE`]!) : defaults.temperature),
    maxTokens: config?.maxTokens ?? 
      (process.env[`${agentPrefix}MODEL_MAX_TOKENS`] ? parseInt(process.env[`${agentPrefix}MODEL_MAX_TOKENS`]!) : defaults.maxTokens)
  };

  let model: BaseChatModel;
  
  switch (provider) {
    case 'anthropic':
      model = new ChatAnthropic({
        anthropicApiKey: process.env.ANTHROPIC_API_KEY,
        modelName: finalConfig.modelName,
        temperature: finalConfig.temperature,
        maxTokens: finalConfig.maxTokens
      });
      break;
    
    case 'openai':
      model = new ChatOpenAI({
        openAIApiKey: process.env.OPENAI_API_KEY,
        modelName: finalConfig.modelName,
        temperature: finalConfig.temperature,
        maxTokens: finalConfig.maxTokens
      });
      break;
    
    default:
      throw new Error(`Unsupported model provider: ${provider}`);
  }

  return {
    model,
    provider,
    modelName: finalConfig.modelName,
    temperature: finalConfig.temperature!,
    maxTokens: finalConfig.maxTokens!
  };
}


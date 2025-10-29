import { LLMClient } from "../../../core/ports";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage } from "@langchain/core/messages";

export type ModelProvider = 'anthropic' | 'openai';

function resolveProvider(agentType?: string, override?: ModelProvider): ModelProvider {
  if (override) return override;
  const prefix = agentType ? `${agentType.toUpperCase()}_` : '';
  return (process.env[`${prefix}MODEL_PROVIDER`] as ModelProvider) || (process.env.AI_MODEL_PROVIDER as ModelProvider) || 'openai';
}

function resolveModelName(provider: ModelProvider, agentType?: string): string {
  const prefix = agentType ? `${agentType.toUpperCase()}_` : '';
  return process.env[`${prefix}MODEL_NAME`] || process.env.AI_MODEL_NAME || (provider === 'anthropic' ? 'claude-3-haiku-20240307' : 'gpt-4o');
}

function resolveTemperature(agentType?: string, fallback = 0.2): number {
  const prefix = agentType ? `${agentType.toUpperCase()}_` : '';
  if (process.env[`${prefix}MODEL_TEMPERATURE`]) return parseFloat(process.env[`${prefix}MODEL_TEMPERATURE`]!);
  if (agentType === 'architect') return 0.1;
  return fallback;
}

function resolveMaxTokens(agentType?: string, fallback = 4000): number {
  const prefix = agentType ? `${agentType.toUpperCase()}_` : '';
  if (process.env[`${prefix}MODEL_MAX_TOKENS`]) return parseInt(process.env[`${prefix}MODEL_MAX_TOKENS`]!);
  return fallback;
}

export interface LLMConfig {
  llmProvider?: string;
  llmModel?: string;
  temperature?: number;
  maxTokens?: number;
}

export class GenericLLMClient implements LLMClient {
  private model: BaseChatModel;

  constructor(private agentType?: string, providerOverride?: ModelProvider, config?: LLMConfig) {
    // Priority: config > providerOverride > env vars
    const provider = (config?.llmProvider as ModelProvider) || resolveProvider(agentType, providerOverride);
    const modelName = config?.llmModel || resolveModelName(provider, agentType);
    const temperature = config?.temperature ?? resolveTemperature(agentType);
    const maxTokens = config?.maxTokens ?? resolveMaxTokens(agentType, provider === 'openai' ? 16000 : 4000);

    switch (provider) {
      case 'anthropic':
        this.model = new ChatAnthropic({
          anthropicApiKey: process.env.ANTHROPIC_API_KEY,
          modelName,
          temperature,
          maxTokens,
        });
        break;
      case 'openai':
      default:
        this.model = new ChatOpenAI({
          openAIApiKey: process.env.OPENAI_API_KEY,
          modelName,
          temperature,
          maxTokens,
        });
    }
  }

  async invoke(messages: Array<{ role: string; content: string }>): Promise<string> {
    const resp = await this.model.invoke(messages.map(m => new HumanMessage(m.content)));
    return typeof (resp as any).content === 'string' ? (resp as any).content : JSON.stringify((resp as any).content);
  }

  async *stream(messages: Array<{ role: string; content: string }>): AsyncIterable<string> {
    const stream = await this.model.stream(messages.map(m => new HumanMessage(m.content)));
    
    for await (const chunk of stream) {
      const content = (chunk as any).content;
      if (typeof content === 'string') {
        yield content;
      }
    }
  }
}

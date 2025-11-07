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

function resolveMaxTokens(agentType?: string, fallback = 16000): number {
  const prefix = agentType ? `${agentType.toUpperCase()}_` : '';
  if (process.env[`${prefix}MODEL_MAX_TOKENS`]) return parseInt(process.env[`${prefix}MODEL_MAX_TOKENS`]!);
  return fallback;
}

export interface LLMConfig {
  llmProvider?: string;
  llmModel?: string;
  temperature?: number;
  maxTokens?: number;
  timeout?: number;  // Timeout in milliseconds (default: 180000 = 3 minutes)
}

export class GenericLLMClient implements LLMClient {
  private model: BaseChatModel;

  constructor(private agentType?: string, providerOverride?: ModelProvider, config?: LLMConfig) {
    // Priority: config > providerOverride > env vars
    const provider = (config?.llmProvider as ModelProvider) || resolveProvider(agentType, providerOverride);
    const modelName = config?.llmModel || resolveModelName(provider, agentType);
    const temperature = config?.temperature ?? resolveTemperature(agentType);
    const maxTokens = config?.maxTokens ?? resolveMaxTokens(agentType, 16000);
    const timeout = config?.timeout ?? 180000; // Default: 3 minutes

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
          timeout,
        });
    }
  }

  async invoke(messages: Array<{ role: string; content: string }>): Promise<string> {
    return this.invokeWithRetry(async () => {
      const resp = await this.model.invoke(messages.map(m => new HumanMessage(m.content)));
      return typeof (resp as any).content === 'string' ? (resp as any).content : JSON.stringify((resp as any).content);
    });
  }
  
  /**
   * Retry wrapper for API calls with exponential backoff
   * Handles transient errors like overloaded_error and rate_limit_error
   */
  private async invokeWithRetry<T>(
    fn: () => Promise<T>,
    maxRetries: number = 5,
    initialDelay: number = 1000
  ): Promise<T> {
    let lastError: any;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error: any) {
        lastError = error;
        
        // Check if error is retryable
        const errorType = error?.error?.error?.type || error?.error?.type;
        const isRetryable = errorType === 'overloaded_error' || errorType === 'rate_limit_error';
        
        if (!isRetryable || attempt === maxRetries) {
          throw error;
        }
        
        // Calculate delay with exponential backoff: 1s, 2s, 4s, 8s, 16s
        const delay = initialDelay * Math.pow(2, attempt);
        
        console.log(`\n⚠️  API ${errorType} - Retrying in ${delay / 1000}s (attempt ${attempt + 1}/${maxRetries})...`);
        
        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    
    throw lastError;
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

  async invokeStructured<T = any>(
    messages: Array<{ role: string; content: string }>,
    schema: Record<string, any>,
    schemaName: string
  ): Promise<T> {
    return this.invokeWithRetry(async () => {
      // Use LangChain's withStructuredOutput for both Anthropic and OpenAI
      // This handles the provider-specific implementation automatically:
      // - Anthropic: tool use
      // - OpenAI: response_format with json_schema
      const structuredModel = this.model.withStructuredOutput(schema, {
        name: schemaName,
        includeRaw: false
      });
      
      const result = await structuredModel.invoke(
        messages.map(m => new HumanMessage(m.content))
      );
      
      return result as T;
    });
  }
}

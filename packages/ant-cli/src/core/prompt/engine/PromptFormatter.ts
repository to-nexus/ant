import { PromptModeConfig } from "./ModeController";
import { FilePromptAdapter } from "../../../periphery/adapters/prompt/FilePromptAdapter";

/**
 * Message format for LLM API
 */
export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * Formatted prompt ready for LLM invocation
 */
export interface FormattedPrompt {
  messages: LLMMessage[];
  parameters: {
    temperature: number;
    maxTokens?: number;
    topP?: number;
    stopSequences?: string[];
  };
  metadata: {
    job: string;
    phase: string;
    mode?: string;
    timestamp: string;
  };
}

/**
 * PromptFormatter - Layer 6
 * Formats complete prompt into LLM API structure
 * 
 * Responsibilities:
 * - Format messages for LLM API
 * - Apply model-specific formatting
 * - Add metadata for tracking
 * - Handle different message structures (system vs user)
 */
export class PromptFormatter {
  /**
   * Format prompt for LLM invocation
   */
  format(
    promptText: string,
    modeConfig: PromptModeConfig,
    options?: {
      systemMessage?: string;
      previousMessages?: LLMMessage[];
    }
  ): FormattedPrompt {
    const messages: LLMMessage[] = [];
    
    // Add previous messages if provided (for conversation context)
    if (options?.previousMessages) {
      messages.push(...options.previousMessages);
    }
    
    // Add system message if provided (separate from prompt)
    if (options?.systemMessage) {
      messages.push({
        role: "system",
        content: options.systemMessage
      });
    }
    
    // Add main prompt as user message
    messages.push({
      role: "user",
      content: promptText
    });
    
    // Build parameters from mode config
    const parameters = {
      temperature: modeConfig.llmParams.temperature,
      maxTokens: modeConfig.llmParams.maxTokens,
      topP: modeConfig.llmParams.topP,
      stopSequences: this.getStopSequences(modeConfig)
    };
    
    // Add metadata for tracking/debugging
    const metadata = {
      job: modeConfig.job,
      phase: modeConfig.phase,
      mode: modeConfig.mode,
      timestamp: new Date().toISOString()
    };
    
    return {
      messages,
      parameters,
      metadata
    };
  }
  
  /**
   * Format for enforcement/retry (with violation message)
   * 
   * CRITICAL: DO NOT include original directive in enforcement!
   * - LLM should ONLY fix validation errors
   * - NOT repeat the original task
   */
  async formatEnforcement(
    originalPrompt: string,
    violationMessage: string,
    modeConfig: PromptModeConfig
  ): Promise<FormattedPrompt> {
    // ✅ Ensure violationMessage is a string (defensive)
    let errorText: string;
    if (typeof violationMessage === 'string') {
      errorText = violationMessage;
    } else {
      // Try JSON.stringify with circular reference handling
      try {
        errorText = JSON.stringify(violationMessage, null, 2);
      } catch (circularError) {
        console.error('⚠️  Warning: Converting circular structure, using fallback');
        // Fallback: use toString() or describe the type
        const vm: any = violationMessage;
        if (vm && typeof vm.toString === 'function') {
          errorText = vm.toString();
        } else {
          errorText = `[${typeof violationMessage}] ${String(violationMessage)}`;
        }
      }
    }
    
    // ❌ OLD: Prepend violation message to original prompt (causes repetition)
    // const enforcementPrompt = `${violationMessage}\n\n${originalPrompt}`;
    
    const adapter = new FilePromptAdapter();
    const enforcementPrompt = await adapter.render('code/phases/enforce/rules-enforcement', { errorText });

    
    // Use slightly higher temperature for retry
    const adjustedConfig = {
      ...modeConfig,
      llmParams: {
        ...modeConfig.llmParams,
        temperature: Math.min(modeConfig.llmParams.temperature + 0.1, 1.0)
      }
    };
    
    return this.format(enforcementPrompt, adjustedConfig);
  }
  
  /**
   * Extract final prompt text from formatted structure
   * (for debugging or logging)
   */
  extractText(formatted: FormattedPrompt): string {
    return formatted.messages
      .map(m => `[${m.role.toUpperCase()}]\n${m.content}`)
      .join('\n\n---\n\n');
  }
  
  /**
   * Get stop sequences for task
   */
  private getStopSequences(modeConfig: PromptModeConfig): string[] | undefined {
    // Define stop sequences that indicate end of response
    // This helps prevent overly long responses
    
    if (modeConfig.job === 'code') {
      // Stop if model starts explaining after code
      return [
        '\n\n---\n\n',  // Common separator
        '\n\nNote:',     // Explanation prefix
        '\n\nRemember:', // Reminder prefix
      ];
    }
    
    return undefined;
  }
}


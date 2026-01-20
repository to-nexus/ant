import { PromptModeConfig } from "./ModeController";

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
  formatEnforcement(
    originalPrompt: string,
    violationMessage: string,
    modeConfig: PromptModeConfig
  ): FormattedPrompt {
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
    
    // ✅ NEW: Create focused enforcement prompt WITHOUT original directive
    const enforcementPrompt = `${errorText}

🚨 CRITICAL INSTRUCTIONS - READ CAREFULLY:

1. FIX ONLY THE ABOVE VALIDATION ERRORS
   - DO NOT regenerate or repeat the original implementation
   - ONLY modify the files necessary to fix these specific errors

2. FOCUS ON ROOT CAUSES:
   - Missing @types/* packages → Add to package.json devDependencies  
   - TypeScript config errors → Update tsconfig.json
   - Import/module errors → Fix import paths or file names
   - Build configuration errors → Update config files

3. OUTPUT FORMAT (MANDATORY):
   
   ⚠️  CHOOSE THE CORRECT FORMAT BASED ON FILE STATUS:
   
   **For EXISTING files** (files already in the codebase):
   <edit path="path/to/file.ext">
   <search>
   [exact code section to find - must match perfectly]
   </search>
   <replace>
   [new code to replace with]
   </replace>
   </edit>
   
   **For NEW files only** (files that don't exist yet):
   <file path="path/to/file.ext">
   [complete file content - write EVERY line]
   </file>
   
   ⚠️  CRITICAL: Use <edit> for modifications, <file> only for new files!

4. ❌ FORBIDDEN - DO NOT USE:
   - NO <file> tags for existing files (use <edit>!)
   - NO markdown code blocks (NO \`\`\`tsx, \`\`\`typescript, \`\`\`json, etc.)
   - NO markdown headers (NO ### FILE:, ## FILE:, etc.)
   - NO explanatory text before/after files
   - NO ellipsis (...) or placeholder comments
   - NO unclosed XML tags
   
5. EXAMPLE OF CORRECT FORMAT (Editing existing package.json):
   
   <edit path="package.json">
   <search>
   {
     "dependencies": {
       "react": "^18.3.1"
     }
   }
   </search>
   <replace>
   {
     "dependencies": {
       "react": "^18.3.1"
     },
     "devDependencies": {
       "@types/react": "^18.0.0",
       "@types/node": "^20.0.0",
       "typescript": "^5.0.0"
     }
   }
   </replace>
   </edit>

6. VALIDATION RULES:
   - <search> block must match existing file content EXACTLY
   - Use <edit> for all existing files (even config files!)
   - Use <file> only if creating a brand new file
   - Include ALL content in <file> blocks (no shortcuts)
   - Check for missing dependencies carefully
   - Close all XML tags properly

7. END WITH SUMMARY (REQUIRED!):
   After all file operations, provide a brief explanation:
   
   Example:
   <edit path="package.json">...</edit>
   
   Fixed the build errors by adding missing type definitions to devDependencies.
   The build should now succeed.

START YOUR RESPONSE WITH THE FIRST EDIT/FILE (<edit path="..." or <file path="...")`;

    
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


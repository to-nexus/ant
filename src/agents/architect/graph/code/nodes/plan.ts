import { LLMClient } from "../../../../../core/ports";
import { ArchitectGraphState } from "../state";
import { PromptEngine } from "../../../../../core/prompt/engine";

/**
 * Plan Node
 * Generate execution plan based on artifacts
 */
export async function plan(state: ArchitectGraphState): Promise<ArchitectGraphState> {
  const llm = state.deps?.llm as LLMClient;
  const engine = state.deps?.promptEngine as PromptEngine;

  // Check if this is a retry after enforcement
  const isRetry = state.retries > 0;
  const enforcementReason = state.enforcementReason;
  const hasSubtask = Boolean(state.currentSubtask);
  
  if (isRetry) {
    console.log(`\n🔄 RETRY ${state.retries}/${state.maxRetries} - Re-planning after validation failure`);
    
    if (hasSubtask) {
      console.log(`🎯 Current Subtask: ${state.currentSubtask!.name} (${state.subtaskIndex}/${state.totalSubtasks})`);
      console.log(`   Category: ${state.currentSubtask!.category}`);
      console.log(`   Errors: ${state.currentSubtask!.errors.length}`);
      if (state.remainingSubtasks && state.remainingSubtasks.length > 0) {
        console.log(`   Remaining: ${state.remainingSubtasks.map(s => s.name).join(', ')}`);
      }
    }
    
    console.log(`📋 Has enforcementReason: ${!!enforcementReason}`);
    if (enforcementReason) {
      console.log(`📋 Enforcement reason: ${enforcementReason.substring(0, 150)}...\n`);
    } else {
      console.log(`⚠️  Warning: No enforcement reason provided!\n`);
    }
  }

  // Prepare artifacts (using new unified names)
  const artifacts = {
    directive: state.directive,
    designDoc: state.design,         // Map to old name for PromptEngine compatibility
    prdSpec: state.prd,
    currentCode: state.code,         // Map to old name
    originalFiles: state.codeHead,   // Map to old name (git HEAD)
  };

  try {
    // Build prompt using PromptEngine
    const result = await engine.buildPlanPrompt(
      "code",
      state.context,
      artifacts,
      state.codeMode
    );

    // Invoke LLM with streaming
    let planText = '';
    
    console.log(`⏱️  Prompt build time: ${result.metadata.buildTime}ms`);
    console.log(`🎯 Inferred mode: ${result.modeConfig.mode}`);
    
    // If this is a retry, prepend validation errors to help plan better
    let promptMessages = result.formatted.messages;
    if (isRetry && enforcementReason) {
      const retryContext = `
🔴 PREVIOUS ATTEMPT FAILED - VALIDATION ERRORS:

${enforcementReason}

📋 INSTRUCTIONS FOR RE-PLANNING:
1. Analyze WHY the previous approach failed
2. Identify the ROOT CAUSE (not just symptoms)
3. Create a DIFFERENT strategy that addresses the core issue
4. Focus on:
   - Missing dependencies → Ensure ALL required packages are listed
   - Type errors → Add proper type definitions and @types/* packages
   - Import errors → Verify all import paths match actual file structure
   - Config errors → Ensure tsconfig.json, vite.config, etc. are correct

CRITICAL: Your NEW plan must take a DIFFERENT approach from what failed before.
`;
      
      // Add retry context to the user message
      promptMessages = result.formatted.messages.map((msg, idx) => {
        if (idx === promptMessages.length - 1 && msg.role === 'user') {
          return {
            ...msg,
            content: retryContext + '\n\n' + msg.content
          };
        }
        return msg;
      });
    }
    
    console.log('\n📝 Generating plan...\n');
    
    if (llm.stream) {
      // Use streaming if available
      for await (const chunk of llm.stream(promptMessages)) {
        process.stdout.write(chunk);
        // Force flush for real-time output
        try {
          // @ts-ignore - _handle is internal Node.js API
          if (typeof process.stdout._handle?.flush === 'function') {
            // @ts-ignore
            process.stdout._handle.flush();
          }
        } catch {
          // Ignore flush errors
        }
        planText += chunk;
      }
      console.log('\n');
    } else {
      // Fallback to regular invoke
      planText = await llm.invoke(promptMessages);
    }

    const codeMode = result.modeConfig.mode;

    console.log('\n✅ Plan generation complete');
    
    // Clear enforcementReason after using it in plan
    return { 
      ...state, 
      planText, 
      codeMode,
      enforcementReason: null  // Clear for next cycle
    };
  } catch (error) {
    console.error('❌ [Plan] Error occurred:', error);
    throw error; // Re-throw to let LangGraph handle it
  }
}

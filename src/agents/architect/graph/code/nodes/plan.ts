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
    console.log('\n📝 Generating plan...\n');
    
    if (llm.stream) {
      // Use streaming if available
      for await (const chunk of llm.stream(result.formatted.messages)) {
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
      planText = await llm.invoke(result.formatted.messages);
    }

    const codeMode = result.modeConfig.mode;

    console.log('\n✅ Plan generation complete');
    
    return { ...state, planText, codeMode };
  } catch (error) {
    console.error('❌ [Plan] Error occurred:', error);
    throw error; // Re-throw to let LangGraph handle it
  }
}

import { DesignGraphState } from "../state";
import { LLMClient } from "../../../../../core/ports";
import { PromptEngine } from "../../../../../core/prompt/engine";

/**
 * Execute Node
 * Generate design document based on plan
 */
export async function execute(state: DesignGraphState) {
  const llm = state.deps?.llm as LLMClient;
  const engine = state.deps?.promptEngine as PromptEngine;

  // Prepare artifacts (using new unified names)
  const artifacts = {
    directive: state.directive,
    designDoc: undefined,              // Design doesn't use design as input
    prdSpec: state.prd,               // PRD
    previousDesign: state.design,     // Previous design
    currentCode: state.code,          // Codebase (for evolution/refactor)
    originalFiles: undefined,         // Design doesn't use git HEAD
  };

  // Build prompt using PromptEngine
  const result = await engine.buildExecutePrompt(
    "design",
    state.context,
    artifacts,
    state.planText
  );

  // Generate design with streaming
  let designMarkdown = '';
  
  console.log(`⏱️  Prompt build time: ${result.metadata.buildTime}ms`);
  console.log('\n📐 Generating design document...\n');
  
  if (llm.stream) {
    // Use streaming if available
    for await (const chunk of llm.stream(result.formatted.messages)) {
      process.stdout.write(chunk);
      designMarkdown += chunk;
    }
    console.log('\n');
  } else {
    // Fallback to regular invoke
    designMarkdown = await llm.invoke(result.formatted.messages);
  }

  return { ...state, designMarkdown };
}

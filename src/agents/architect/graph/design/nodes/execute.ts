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

  const designMarkdown = await llm.invoke(result.formatted.messages);

  console.log(`⏱️  Prompt build time: ${result.metadata.buildTime}ms`);

  return { ...state, designMarkdown };
}

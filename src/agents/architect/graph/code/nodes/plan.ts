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

  // Build prompt using PromptEngine
  const result = await engine.buildPlanPrompt(
    "code",
    state.context,
    artifacts,
    state.codeMode
  );

  // Invoke LLM with formatted prompt
  const resp = await llm.invoke(result.formatted.messages);
  const planText = resp;

  // Update code mode from mode config
  const codeMode = result.modeConfig.mode;

  console.log(`⏱️  Prompt build time: ${result.metadata.buildTime}ms`);
  console.log(`🎯 Inferred mode: ${codeMode}`);

  return { ...state, planText, codeMode };
}

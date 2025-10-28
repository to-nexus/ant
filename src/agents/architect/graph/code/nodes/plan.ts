import { LLMClient } from "../../../../../core/ports";
import { ArchitectGraphState } from "../state";
import { PromptEngine } from "../../../../../core/prompt/engine";

export async function plan(state: ArchitectGraphState): Promise<ArchitectGraphState> {
  const llm = state.deps?.llm as LLMClient;
  const engine = state.deps?.promptEngine as PromptEngine;

  const artifacts = {
    directive: state.directive || undefined,
    designDoc: state.latestDesign || undefined,
    prdSpec: state.spec || undefined,
    originalFiles: state.originalFilesBlock || undefined,
    currentCode: undefined
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

  return { ...state, planText, codeMode };
}

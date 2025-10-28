import { DesignGraphState } from "../state";
import { LLMClient } from "../../../../../core/ports";
import { PromptEngine } from "../../../../../core/prompt/engine";

export async function execute(state: DesignGraphState) {
  const llm = state.deps?.llm as LLMClient;
  const engine = state.deps?.promptEngine as PromptEngine;

  const artifacts = {
    directive: state.directive || undefined,
    designDoc: undefined,
    prdSpec: state.spec || undefined,
    originalFiles: undefined,
    currentCode: undefined
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

  return { designMarkdown };
}


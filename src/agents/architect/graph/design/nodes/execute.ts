import { DesignGraphState } from "../state";
import { LLMClient } from "../../../../../core/ports";
import { ArchitectPromptor } from "../../../prompt/ArchitectPromptor";

export async function execute(state: DesignGraphState) {
  const llm = state.deps?.llm as LLMClient;
  const promptor = state.deps?.promptor as ArchitectPromptor;

  const executePrompt = await promptor.buildDesignExecutePrompt(
    state.context,
    state.planText
  );

  const designMarkdown = await llm.invoke([{ role: 'user', content: executePrompt }]);

  return { designMarkdown };
}


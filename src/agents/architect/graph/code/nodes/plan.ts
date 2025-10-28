import { LLMClient } from "../../../../../core/ports";
import { ArchitectPromptor } from "../../../prompt/ArchitectPromptor";
import { ArchitectGraphState } from "../state";
import { inferCodeMode } from "../../../modeInference";

export async function plan(state: ArchitectGraphState): Promise<ArchitectGraphState> {
  const llm = state.deps?.llm as LLMClient;
  const promptor = state.deps?.promptor as ArchitectPromptor;

  // Infer code mode if not provided
  const codeMode = state.codeMode || inferCodeMode(
    state.directive,
    Boolean(state.originalFilesBlock)
  );

  const inputs = {
    directive: state.directive || null,
    currentCode: null,
    originalFiles: state.originalFilesBlock || null,
    designDoc: state.latestDesign || null,
    prdSpec: state.spec || null,
    memory: state.context.memory || null,
  };

  const planPrompt = await promptor.buildPlanPrompt("code", state.context, inputs, codeMode);
  const resp = await llm.invoke([{ role: 'user', content: planPrompt }]);
  const planText = resp;

  return { ...state, planText, codeMode };
}

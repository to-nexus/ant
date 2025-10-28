import { LLMClient } from "../../../../../core/ports";
import { ArchitectPromptor } from "../../../prompt/ArchitectPromptor";
import { ArchitectGraphState } from "../state";

export async function plan(state: ArchitectGraphState): Promise<ArchitectGraphState> {
  const llm = state.deps?.llm as LLMClient;
  const promptor = state.deps?.promptor as ArchitectPromptor;
  
  const inputs = {
    directive: state.directive || null,
    currentCode: null,
    originalFiles: state.originalFilesBlock || null,
    designDoc: state.latestDesign || null,
    prdSpec: state.spec || null,
    memory: state.context.memory || null,
  };

  const planPrompt = await promptor.buildUniversalPlanPrompt(state.context, inputs);
  const resp = await llm.invoke([{ role: 'user', content: planPrompt }]);
  const planText = resp;

  return { ...state, planText };
}

import { DesignGraphState } from "../state";
import { LLMClient } from "../../../../../core/ports";
import { ArchitectPromptor } from "../../../prompt/ArchitectPromptor";

export async function plan(state: DesignGraphState) {
  const llm = state.deps?.llm as LLMClient;
  const promptor = state.deps?.promptor as ArchitectPromptor;

  const inputs = {
    directive: state.directive || null,
    previousDesign: state.previousDesign || null,
    prdSpec: state.spec || null,
  };

  const planPrompt = await promptor.buildDesignPlanPrompt(state.context, inputs);
  const planText = await llm.invoke([{ role: 'user', content: planPrompt }]);

  return { planText };
}

import { HumanMessage } from "@langchain/core/messages";
import { createModel } from "../../llm/createModel";
import { ArchitectPromptor } from "../../prompt/ArchitectPromptor";
import { ArchitectGraphState } from "../state";

export async function plan(state: ArchitectGraphState): Promise<ArchitectGraphState> {
  const { model } = createModel("architect");
  const extrasContext = state.originalFilesBlock ? `\n\nORIGINAL FILES:\n${state.originalFilesBlock}` : "";
  const inputs = {
    directive: state.directive || null,
    currentCode: null,
    originalFiles: state.originalFilesBlock || null,
    designDoc: state.latestDesign || null,
    prdSpec: state.spec || null,
    memory: state.context.memory || null,
  } as any;

  const planPrompt = ArchitectPromptor.buildUniversalPlanPrompt(state.context, inputs);
  const resp = await model.invoke([new HumanMessage(planPrompt)]);
  const planText = typeof resp.content === 'string' ? resp.content : JSON.stringify(resp.content);

  return { ...state, planText };
}

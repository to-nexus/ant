import { LLMClient } from "../../../../../core/ports";
import { ArchitectPromptor } from "../../../prompt/ArchitectPromptor";
import { ArchitectGraphState } from "../state";
import { parseResponse } from "./parseResponse";

/**
 * Execute node - generates code using LLM
 * Can be used for initial generation or enforcement (with reasonHeader)
 */
export async function execute(
  state: ArchitectGraphState, 
  reasonHeader?: string
): Promise<ArchitectGraphState> {
  const llm = state.deps?.llm as LLMClient;
  const promptor = state.deps?.promptor as ArchitectPromptor;
  
  let finalPrompt: string;
  
  if (reasonHeader) {
    // Enforcement mode: prepend violation message to existing prompt
    finalPrompt = `${reasonHeader}\n\n${state.codePrompt}`;
  } else {
    // Initial generation mode: build fresh prompt
    const inputs = {
      directive: state.directive || null,
      currentCode: null,
      originalFiles: state.originalFilesBlock || null,
      designDoc: state.latestDesign || null,
      prdSpec: state.spec || null,
      memory: state.context.memory || null,
    };
    finalPrompt = await promptor.buildExecutePrompt("code", state.context, inputs, state.planText, state.codeMode || 'edit', state.codebaseProfile);
  }

  const raw = await llm.invoke([{ role: 'user', content: finalPrompt }]);
  const { responseSection, files, filesToDelete } = parseResponse(raw);

  return { 
    ...state, 
    codePrompt: reasonHeader ? state.codePrompt : finalPrompt,
    rawResponse: raw, 
    responseSection, 
    files, 
    filesToDelete 
  };
}


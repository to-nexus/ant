import { LLMClient } from "../../../../../core/ports";
import { ArchitectGraphState } from "../state";
import { parseResponse } from "./parseResponse";
import { PromptEngine } from "../../../../../core/prompt/engine";

/**
 * Execute node - generates code using LLM
 * Can be used for initial generation or enforcement (with reasonHeader)
 */
export async function execute(
  state: ArchitectGraphState, 
  reasonHeader?: string
): Promise<ArchitectGraphState> {
  const llm = state.deps?.llm as LLMClient;
  const engine = state.deps?.promptEngine as PromptEngine;
  
  let formatted;
  let buildResult;
  
  // Prepare artifacts (using new unified names)
  const artifacts = {
    directive: state.directive,
    designDoc: state.design,         // Map to old name
    prdSpec: state.prd,
    currentCode: state.code,         // Map to old name
    originalFiles: state.codeHead,   // Map to old name
  };
  
  if (reasonHeader) {
    // Enforcement mode: rebuild with violation message
    buildResult = await engine.buildExecutePrompt(
      "code",
      state.context,
      artifacts,
      state.planText,
      state.codeMode
    );
    
    formatted = engine.buildEnforcementPrompt(buildResult, reasonHeader);
  } else {
    // Initial generation mode: build fresh prompt
    buildResult = await engine.buildExecutePrompt(
      "code",
      state.context,
      artifacts,
      state.planText,
      state.codeMode
    );
    
    formatted = buildResult.formatted;
    
    console.log(`⏱️  Prompt build time: ${buildResult.metadata.buildTime}ms`);
  }

  const raw = await llm.invoke(formatted.messages);
  const { responseSection, files, filesToDelete } = parseResponse(raw);

  return {
    ...state,
    rawResponse: raw,
    responseSection,
    files,
    filesToDelete
  };
}

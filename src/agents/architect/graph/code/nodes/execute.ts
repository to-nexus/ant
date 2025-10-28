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
  
  if (reasonHeader) {
    // Enforcement mode: use previous build result with violation message
    // Note: We need to store previous build result in state for this to work properly
    // For now, rebuild with enforcement
    const artifacts = {
      directive: state.directive || undefined,
      designDoc: state.latestDesign || undefined,
      prdSpec: state.spec || undefined,
      originalFiles: state.originalFilesBlock || undefined,
      currentCode: undefined
    };
    
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
    const artifacts = {
      directive: state.directive || undefined,
      designDoc: state.latestDesign || undefined,
      prdSpec: state.spec || undefined,
      originalFiles: state.originalFilesBlock || undefined,
      currentCode: undefined
    };
    
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
    codePrompt: engine.extractPromptText(buildResult),
    rawResponse: raw, 
    responseSection, 
    files, 
    filesToDelete 
  };
}


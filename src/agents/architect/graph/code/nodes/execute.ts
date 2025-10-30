import { LLMClient } from "../../../../../core/ports";
import { ArchitectGraphState } from "../state";
import { parseResponse } from "./parseResponse";
import { PromptEngine } from "../../../../../core/prompt/engine";

/**
 * Execute node - generates code using LLM
 * Can be used for initial generation or enforcement (with reasonHeader)
 */
export async function execute(
  state: ArchitectGraphState
): Promise<ArchitectGraphState> {
  try {
    const llm = state.deps?.llm as LLMClient;
    const engine = state.deps?.promptEngine as PromptEngine;
  
  // Prepare artifacts (using new unified names)
  const artifacts = {
    directive: state.directive,
    designDoc: state.design,         // Map to old name
    prdSpec: state.prd,
    currentCode: state.code,         // Map to old name
    originalFiles: state.codeHead,   // Map to old name
  };
  
  // Build prompt using PromptEngine
  const buildResult = await engine.buildExecutePrompt(
    "code",
    state.context,
    artifacts,
    state.planText,
    state.codeMode
  );
  
  const formatted = buildResult.formatted;
  
  console.log(`⏱️  Prompt build time: ${buildResult.metadata.buildTime}ms`);

  // Generate code with streaming
  let raw = '';
  
  console.log('\n💻 Generating code...\n');
  
    if (llm.stream) {
    // Use streaming if available
    for await (const chunk of llm.stream(formatted.messages)) {
      process.stdout.write(chunk);
      // Force flush for real-time output
      try {
        // @ts-ignore - _handle is internal Node.js API
        if (typeof process.stdout._handle?.flush === 'function') {
          // @ts-ignore
          process.stdout._handle.flush();
        }
      } catch {
        // Ignore flush errors
      }
      raw += chunk;
    }
    console.log('\n');
  } else {
    // Fallback to regular invoke
    raw = await llm.invoke(formatted.messages);
  }
  
    const { responseSection, files, filesToDelete } = parseResponse(raw);

    return {
      ...state,
      rawResponse: raw,
      responseSection,
      files,
      filesToDelete
    };
  } catch (error) {
    console.error('❌ [Execute] CRITICAL ERROR:', error);
    console.error('❌ [Execute] Error type:', typeof error);
    console.error('❌ [Execute] Error details:', error instanceof Error ? error.message : String(error));
    
    // Return state with empty files to trigger validation failure
    return {
      ...state,
      files: [],
      filesToDelete: [],
      violations: [...(state.violations || []), `Execute error: ${error instanceof Error ? error.message : String(error)}`]
    };
  }
}


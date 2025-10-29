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
  const reasonHeader = (state as any).enforcementReason;
  
  try {
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
    console.log('\n🔴 ENFORCEMENT MODE - Fixing validation errors\n');
    
    let errorText: string = '';
    if (typeof reasonHeader === 'string') {
      errorText = reasonHeader;
    } else {
      try {
        errorText = JSON.stringify(reasonHeader, null, 2);
      } catch (circularError) {
        const rh: any = reasonHeader;
        if (rh && typeof rh.toString === 'function') {
          errorText = rh.toString();
        } else {
          errorText = `[${typeof reasonHeader}] ${String(reasonHeader)}`;
        }
      }
    }
    
    // Load package.json for dependency/type errors
    if (errorText.includes('Could not find a declaration file') || 
        errorText.includes('Cannot find module') ||
        errorText.includes('@types/')) {
      try {
        const fs = await import('fs/promises');
        const path = await import('path');
        const pkgPath = path.join(state.context.workingDir, 'package.json');
        const pkgContent = await fs.readFile(pkgPath, 'utf-8');
        
        if (!artifacts.currentCode?.includes('"name":') || 
            !artifacts.currentCode?.includes('"dependencies":')) {
          artifacts.currentCode = (artifacts.currentCode || '') + 
            `\n\n=== package.json ===\n${pkgContent}\n`;
        }
      } catch (error: any) {
        console.warn('⚠️  Could not load package.json:', error.message);
      }
    }
    
    buildResult = await engine.buildExecutePrompt(
      "code",
      state.context,
      artifacts,
      state.planText,
      state.codeMode
    );
    
    formatted = engine.buildEnforcementPrompt(buildResult, errorText);
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


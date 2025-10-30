import { LLMClient } from "../../../../../core/ports";
import { ArchitectGraphState, AttemptHistory, Violation } from "../state";
import { parseResponse } from "./parseResponse";
import { PromptEngine } from "../../../../../core/prompt/engine";

/**
 * Extract key changes from generated files
 * Focus on package.json changes and new file types
 */
function extractKeyChanges(files: Array<{ path: string; content: string }>): string[] {
  const changes: string[] = [];
  
  for (const file of files) {
    // Package.json changes - very important!
    if (file.path.includes('package.json')) {
      try {
        const pkg = JSON.parse(file.content);
        
        if (pkg.dependencies) {
          const deps = Object.keys(pkg.dependencies);
          if (deps.length > 0) {
            changes.push(`Added dependencies: ${deps.join(', ')}`);
          }
        }
        
        if (pkg.devDependencies) {
          const devDeps = Object.keys(pkg.devDependencies);
          if (devDeps.length > 0) {
            changes.push(`Added devDependencies: ${devDeps.join(', ')}`);
          }
        }
      } catch {
        changes.push('Modified package.json');
      }
    }
    
    // Config files
    else if (file.path.includes('tsconfig.json')) {
      changes.push('Created/modified tsconfig.json');
    }
    else if (file.path.includes('vite.config')) {
      changes.push('Created/modified vite.config');
    }
    else if (file.path.endsWith('.html')) {
      changes.push(`Created HTML entry: ${file.path}`);
    }
    // Component/source files
    else if (file.path.match(/\.(tsx?|jsx?)$/)) {
      changes.push(`Created component: ${file.path}`);
    }
  }
  
  return changes;
}

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

    // Record this attempt for learning
    const filesGenerated = files.map(f => f.path);
    const keyChanges = extractKeyChanges(files);
    
    const currentAttempt: AttemptHistory = {
      attemptNumber: (state.previousAttempts?.length || 0) + 1,
      filesGenerated,
      keyChanges,
      subtaskName: state.currentTask?.name,
      errorsAttemptedToFix: state.currentTask?.errors || 
        (state.violations?.map(v => v.message) || [])
    };
    
    // Add to history
    const previousAttempts = [...(state.previousAttempts || []), currentAttempt];
    
    console.log(`\n📝 Attempt #${currentAttempt.attemptNumber} recorded:`);
    console.log(`   Files: ${filesGenerated.length}`);
    console.log(`   Changes: ${keyChanges.length}`);
    if (keyChanges.length > 0) {
      keyChanges.forEach(change => console.log(`      - ${change}`));
    }

    return {
      ...state,
      rawResponse: raw,
      responseSection,
      files,
      filesToDelete,
      previousAttempts
    };
  } catch (error) {
    console.error('❌ [Execute] CRITICAL ERROR:', error);
    console.error('❌ [Execute] Error type:', typeof error);
    console.error('❌ [Execute] Error details:', error instanceof Error ? error.message : String(error));
    
    // Return state with empty files to trigger validation failure
    const executeError: Violation = {
      type: 'other',
      severity: 'critical',
      message: `Execute error: ${error instanceof Error ? error.message : String(error)}`,
      suggestedFix: 'Check LLM response parsing or connection',
      isRetryable: true
    };
    
    return {
      ...state,
      files: [],
      filesToDelete: [],
      violations: [...(state.violations || []), executeError]
    };
  }
}


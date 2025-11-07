import { LLMClient } from "../../../../../core/ports";
import { ArchitectGraphState, AttemptHistory, Violation, TaskTimingHelper } from "../state";
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
  // ✅ Workflow instrumentation: Enter node
  if (state.deps?.workflowUpdate && state._httpTaskId) {
    state.deps.workflowUpdate.enterNode(state._httpTaskId, 'execute');
  }
  
  try {
    const llm = state.deps?.llm as LLMClient;
    const engine = state.deps?.promptEngine as PromptEngine;
  
  // ✨ Start timing for current task
  let currentTask = state.currentTask;
  if (currentTask && !currentTask.timing?.startedAt) {
    console.log(`⏱️  Starting timer for task: ${currentTask.name}`);
    currentTask = TaskTimingHelper.startTask(currentTask);
  } else if (currentTask?.timing?.pausedAt) {
    console.log(`⏱️  Resuming timer for task: ${currentTask.name}`);
    currentTask = TaskTimingHelper.startTask(currentTask); // Resumes and accumulates pause duration
  }
  
  // Prepare artifacts (using new unified names)
  const artifacts = {
    directive: state.directive,
    designDoc: state.design,         // Map to old name
    prdSpec: state.prd,
    currentCode: state.code,         // Map to old name
    originalFiles: state.codeHead,   // Map to old name
    currentTask: currentTask ? {  // ✅ Pass current task info (with timing)
      name: currentTask.name,
      type: currentTask.type,
      description: currentTask.description
    } : undefined
  };
  
  // Build prompt using PromptEngine with taskType
  const buildResult = await engine.buildExecutePrompt(
    "code",
    state.context,
    artifacts,
    state.planText,
    state.codeMode,
    state.currentTask?.type  // Pass taskType for language-specific constraints
  );
  
  const formatted = buildResult.formatted;
  
  console.log(`⏱️  Prompt build time: ${buildResult.metadata.buildTime}ms`);

  // ===== COLLECT FILES FROM PREVIOUS COMPLETED TASKS =====
  const filesFromCompletedTasks: Set<string> = new Set();
  
  // Collect files from current task's previous attempts
  // These are files we already generated in earlier attempts of THIS task
  state.previousAttempts?.forEach(attempt => {
    attempt.filesGenerated.forEach(file => {
      filesFromCompletedTasks.add(file);
    });
  });
  
  // ⚠️ Note: We don't have perfect tracking of which files were created by which completed task
  // This is a limitation of the current architecture. We can improve this later by:
  // 1. Adding `filesGenerated?: string[]` to Task interface
  // 2. Storing files when task completes in checkTaskStatus
  // 3. Using that info here
  //
  // For now, we rely on the task description to be specific enough that LLM
  // naturally focuses on its assigned scope.

  // ===== ADD RETRY CONTEXT IF THIS IS A RETRY =====
  let promptMessages = formatted.messages;
  const isRetry = Boolean(state.enforcementReason);
  
  if (isRetry && state.enforcementReason) {
    console.log('⚠️  Adding retry context with error feedback...\n');
    
    // ✅ 이미 시도한 작업들을 명확히 정리
    const alreadyAppliedChanges: string[] = [];
    const alreadyCreatedFiles: Set<string> = new Set();
    
    state.previousAttempts?.forEach(attempt => {
      attempt.keyChanges.forEach(change => {
        if (!alreadyAppliedChanges.includes(change)) {
          alreadyAppliedChanges.push(change);
        }
      });
      attempt.filesGenerated.forEach(file => {
        alreadyCreatedFiles.add(file);
      });
    });
    
    // Format previous attempts
    const previousAttemptsText = state.previousAttempts?.map(attempt => {
      const lines = [`\n### Attempt #${attempt.attemptNumber}`];
      if (attempt.keyChanges.length > 0) {
        lines.push('**Changes:** ' + attempt.keyChanges.join(', '));
      }
      if (attempt.filesGenerated.length > 0) {
        lines.push('**Files:** ' + attempt.filesGenerated.join(', '));
      }
      if (attempt.errorsAttemptedToFix && attempt.errorsAttemptedToFix.length > 0) {
        lines.push('**❌ ERRORS:**');
        attempt.errorsAttemptedToFix.slice(0, 3).forEach(err => lines.push(`  - ${err}`));
      }
      return lines.join('\n');
    }).join('\n') || 'No previous attempts.';
    
    const retryContext = `
🔴 PREVIOUS ATTEMPT FAILED - FIX THESE ERRORS:

${state.enforcementReason}

📝 PREVIOUS ATTEMPTS (${state.previousAttempts?.length || 0} attempts):
${previousAttemptsText}

⚠️ ALREADY APPLIED (DO NOT REPEAT THESE):
${alreadyAppliedChanges.length > 0 ? alreadyAppliedChanges.map(c => `  ✓ ${c}`).join('\n') : '  (None)'}

📂 FILES ALREADY CREATED/MODIFIED:
${alreadyCreatedFiles.size > 0 ? Array.from(alreadyCreatedFiles).map(f => `  ✓ ${f}`).join('\n') : '  (None)'}

⚠️ CRITICAL INSTRUCTIONS FOR RETRY:
1. READ THE ERRORS ABOVE CAREFULLY
2. DO NOT REPEAT THE SAME APPROACH OR CHANGES LISTED ABOVE
3. **ONLY OUTPUT FILES THAT NEED TO BE FIXED OR ADDED**
   - If error is in package.json BUT it's already modified → Try a DIFFERENT fix
   - If error is in specific .ts file → Only output that .ts file
   - If missing file → Only output the missing file
4. DO NOT RE-GENERATE FILES THAT ARE WORKING CORRECTLY
5. DO NOT RE-APPLY CHANGES ALREADY LISTED IN "ALREADY APPLIED" SECTION
6. Think of NEW APPROACHES, not the same solutions that already failed

📋 OUTPUT FORMAT:
- **MINIMAL APPROACH**: Only output files that directly fix the errors above
- **NO REDUNDANCY**: Do not include files that were generated correctly in previous attempts
- **NEW STRATEGY**: Try a different approach than what was already attempted
- **FOCUS**: Fix the specific violations with fresh thinking

📋 NOW GENERATE ONLY THE FILES NEEDED TO FIX THE ERRORS (WITH NEW APPROACH):
`;
    
    // Add retry context to the last user message
    promptMessages = formatted.messages.map((msg, idx) => {
      if (idx === formatted.messages.length - 1 && msg.role === 'user') {
        return {
          ...msg,
          content: retryContext + '\n\n' + msg.content
        };
      }
      return msg;
    });
  } else if (state.completedTasksDetails && state.completedTasksDetails.length > 0) {
    // ===== ADD SCOPE-LIMITING CONTEXT FOR SUBTASKS =====
    const completedTaskCount = state.completedTasksDetails.length;
    const currentTaskName = state.currentTask?.name || 'Current Task';
    const currentTaskDesc = state.currentTask?.description || '';
    
    console.log(`📋 Adding scope-limiting context (${completedTaskCount} tasks already completed)...\n`);
    
    // Show previously completed tasks for context
    const completedTasksList = state.completedTasksDetails
      .slice(-5)  // Show last 5 completed tasks
      .map(t => `  ✅ ${t.name}`)
      .join('\n');
    
    const scopeLimitingContext = `
🎯 TASK EXECUTION CONTEXT:
You are working on a ${state.totalSubtasks > 1 ? 'MULTI-TASK PROJECT' : 'project'} where work is divided into separate, focused tasks.

📊 PROJECT PROGRESS:
- Total tasks: ${state.totalSubtasks || 'N/A'}
- Completed: ${completedTaskCount}
- Current task: "${currentTaskName}"

${completedTaskCount > 0 ? `📝 RECENTLY COMPLETED TASKS:\n${completedTasksList}\n` : ''}

⚠️ CRITICAL: TASK SCOPE LIMITATION
1. **YOUR CURRENT TASK**: "${currentTaskName}"
   ${currentTaskDesc ? `   Description: ${currentTaskDesc}` : ''}
   
2. **FOCUS ONLY ON THIS TASK**
   - Other tasks have already handled their responsibilities
   - Do NOT regenerate files from completed tasks
   - Do NOT duplicate work that was already done
   
3. **MINIMAL OUTPUT RULE**
   - Only generate files that are DIRECTLY REQUIRED for your current task
   - If your task is about routing → Only output routing-related files
   - If your task is about styling → Only output CSS/style files
   - If your task is about a specific feature → Only output files for that feature
   
4. **COMMON FILES TO AVOID REGENERATING**
   - package.json (unless your task explicitly requires dependency changes)
   - tsconfig.json, vite.config.ts (unless your task is about build configuration)
   - README.md (unless your task is about documentation)
   - index.html (unless your task is about the HTML entry point)
   - Core application files (App.tsx, main.tsx) unless they are the focus of your task

5. **WHEN TO MODIFY EXISTING FILES**
   Only modify an existing file if:
   - Your task description explicitly mentions that file
   - The file is directly related to your task scope
   - You need to integrate your new code with existing code

📋 GENERATE ONLY THE FILES REQUIRED FOR YOUR CURRENT TASK:
`;
    
    // Add scope-limiting context to the last user message
    promptMessages = formatted.messages.map((msg, idx) => {
      if (idx === formatted.messages.length - 1 && msg.role === 'user') {
        return {
          ...msg,
          content: scopeLimitingContext + '\n\n' + msg.content
        };
      }
      return msg;
    });
  }

  // Generate code with streaming
  let raw = '';
  
  console.log('\n💻 Generating code...\n');
  
  // Track if we're inside a file block to suppress verbose output
  let insideFileBlock = false;
  let currentFilePath = '';
  let accumulatedChunk = '';
  
  if (llm.stream) {
    // Use streaming if available
    for await (const chunk of llm.stream(promptMessages)) {
      // Accumulate chunks to detect file markers
      accumulatedChunk += chunk;
      
      // Detect file start markers (common patterns in LLM responses)
      const fileStartMatch = accumulatedChunk.match(/```(?:typescript|javascript|tsx|jsx|json|html|css|md|yaml|yml)\n.*?\/([^\n]+)\n/i);
      if (fileStartMatch && !insideFileBlock) {
        insideFileBlock = true;
        currentFilePath = fileStartMatch[1];
        process.stdout.write(`\n📝 Generating file: ${currentFilePath}...\n`);
        accumulatedChunk = '';
      }
      
      // Detect file end marker
      if (accumulatedChunk.includes('```') && insideFileBlock && accumulatedChunk.split('```').length > 2) {
        insideFileBlock = false;
        process.stdout.write(`✓ ${currentFilePath} complete\n`);
        currentFilePath = '';
        accumulatedChunk = '';
      }
      
      // Only show non-file content (explanations, reasoning, etc.)
      if (!insideFileBlock) {
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
      }
      
      raw += chunk;
      
      // Keep only last 500 chars in accumulated chunk to detect markers
      if (accumulatedChunk.length > 500) {
        accumulatedChunk = accumulatedChunk.slice(-500);
      }
    }
    console.log('\n');
  } else {
    // Fallback to regular invoke
    raw = await llm.invoke(promptMessages);
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
      // Use lastViolations (from previous attempt) not current violations (not set yet)
      errorsAttemptedToFix: state.currentTask?.errors || 
        (state.lastViolations?.map(v => v.message) || [])
    };
    
    // Add to history
    const previousAttempts = [...(state.previousAttempts || []), currentAttempt];
    
    console.log(`\n📝 Attempt #${currentAttempt.attemptNumber} recorded:`);
    console.log(`   Files: ${filesGenerated.length}`);
    console.log(`   Changes: ${keyChanges.length}`);
    if (keyChanges.length > 0) {
      keyChanges.forEach(change => console.log(`      - ${change}`));
    }

    const updatedState = {
      ...state,
      currentTask, // ✨ Updated with timing info
      rawResponse: raw,
      responseSection,
      files,
      filesToDelete,
      previousAttempts,
      completedTasksDetails: state.completedTasksDetails || [],  // ✅ Preserve completed tasks
    };
    
    // ✅ Save checkpoint after code generation (in case recursion limit hits during writeFiles)
    const { saveCheckpoint } = await import('./checkpoint');
    await saveCheckpoint(updatedState);
    
    return updatedState;
  } catch (error) {
    console.error('\n❌ ═══════════════════════════════════════════════════════════════');
    console.error('❌ [Execute] CRITICAL ERROR - LLM API CALL FAILED');
    console.error('❌ ═══════════════════════════════════════════════════════════════\n');
    
    // Extract detailed error information
    let errorType = 'unknown';
    let errorMessage = 'Unknown error';
    let suggestedFix = 'Check LLM configuration and connection';
    let isRetryable = true;
    
    // Check if it's an API error with structured format
    if (error && typeof error === 'object') {
      const apiError = error as any;
      
      // Anthropic API error format: { type: "error", error: { type: "...", message: "..." } }
      if (apiError.error?.type) {
        errorType = apiError.error.type;
        errorMessage = apiError.error.message || errorMessage;
        
        switch (apiError.error.type) {
          case 'rate_limit_error':
            console.error('🚨 ERROR TYPE: RATE LIMIT EXCEEDED');
            console.error('📊 You have exceeded the API rate limit');
            console.error('⏰ Please wait a few moments and try again\n');
            suggestedFix = 'Wait 1-2 minutes and re-run the task. The agent will resume from the last checkpoint.';
            isRetryable = false; // User needs to wait
            break;
            
          case 'overloaded':
            console.error('🚨 ERROR TYPE: API OVERLOADED');
            console.error('⚡ The API service is currently overloaded');
            console.error('⏰ Please wait and try again\n');
            suggestedFix = 'Wait 30-60 seconds and re-run the task. The agent will resume from the last checkpoint.';
            isRetryable = false; // User needs to wait
            break;
            
          case 'insufficient_quota':
          case 'insufficient_funds':
            console.error('🚨 ERROR TYPE: INSUFFICIENT API QUOTA/CREDITS');
            console.error('💳 Your API account has insufficient credits');
            console.error('🔗 Please add credits to your API account\n');
            suggestedFix = 'Add credits to your Anthropic API account and re-run the task.';
            isRetryable = false; // User needs to add credits
            break;
            
          case 'invalid_api_key':
          case 'authentication_error':
            console.error('🚨 ERROR TYPE: AUTHENTICATION FAILED');
            console.error('🔑 API key is invalid or missing');
            console.error('⚙️  Please check your ANTHROPIC_API_KEY environment variable\n');
            suggestedFix = 'Set valid ANTHROPIC_API_KEY in your environment and re-run.';
            isRetryable = false; // User needs to fix API key
            break;
            
          case 'api_error':
          default:
            console.error('🚨 ERROR TYPE: API ERROR');
            console.error(`📝 Message: ${errorMessage}\n`);
            suggestedFix = 'Check API status and try again. The agent will resume from the last checkpoint.';
            isRetryable = false;
            break;
        }
      } else if (error instanceof Error) {
        errorMessage = error.message;
        console.error('🚨 ERROR TYPE: EXECUTION ERROR');
        console.error(`📝 Message: ${errorMessage}\n`);
        
        // Check for common network errors
        if (errorMessage.includes('ECONNREFUSED') || errorMessage.includes('ETIMEDOUT')) {
          console.error('🌐 Network connection issue detected');
          suggestedFix = 'Check your internet connection and API endpoint availability.';
          isRetryable = false;
        } else if (errorMessage.includes('timeout')) {
          console.error('⏰ Request timeout detected');
          suggestedFix = 'The request took too long. Try again or check API service status.';
          isRetryable = false;
        }
      }
    }
    
    console.error('❌ Full error details:', JSON.stringify(error, null, 2));
    console.error('❌ ═══════════════════════════════════════════════════════════════\n');
    
    // Return state with empty files to trigger validation failure
    const executeError: Violation = {
      type: 'other',
      severity: 'critical',
      message: `LLM API Error [${errorType}]: ${errorMessage}`,
      suggestedFix,
      isRetryable
    };
    
    return {
      ...state,
      files: [],
      filesToDelete: [],
      violations: [...(state.violations || []), executeError]
    };
  }
}


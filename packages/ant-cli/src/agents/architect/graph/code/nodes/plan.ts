import { LLMClient } from "../../../../../core/ports";
import { ArchitectGraphState, AttemptHistory, Task, Violation, TASK_PRIORITIES } from "../state";
import { PromptEngine } from "../../../../../core/prompt/engine";

/**
 * Format previous attempts for LLM context
 */
function formatPreviousAttempts(attempts: AttemptHistory[]): string {
  if (!attempts || attempts.length === 0) {
    return 'No previous attempts recorded.';
  }
  
  const formatted = attempts.map(attempt => {
    const lines = [
      `\n### Attempt #${attempt.attemptNumber}`,
    ];
    
    if (attempt.keyChanges.length > 0) {
      lines.push('**Changes made:**');
      attempt.keyChanges.forEach(change => {
        lines.push(`  - ${change}`);
      });
    } else {
      lines.push('**Changes made:** None (no files generated)');
    }
    
    if (attempt.filesGenerated.length > 0) {
      lines.push(`**Files created:** ${attempt.filesGenerated.join(', ')}`);
      
      // ⭐ Show file path pattern for consistency
      if (attempt.filesGenerated.length > 0) {
        const firstFile = attempt.filesGenerated[0];
        lines.push(`**📁 Path pattern used:** \`${firstFile}\``);
        if (firstFile.includes('/')) {
          const pathPrefix = firstFile.substring(0, firstFile.lastIndexOf('/') + 1);
          lines.push(`**⚠️ YOU MUST USE THE SAME PATH PREFIX: \`${pathPrefix}\` for ALL files!**`);
        }
      }
    }
    
    // ⭐ CRITICAL: Show what errors occurred after this attempt!
    if (attempt.errorsAttemptedToFix && attempt.errorsAttemptedToFix.length > 0) {
      lines.push('**❌ ERRORS THAT OCCURRED:**');
      attempt.errorsAttemptedToFix.slice(0, 5).forEach(error => {
        lines.push(`  - ${error}`);
      });
      if (attempt.errorsAttemptedToFix.length > 5) {
        lines.push(`  - ... and ${attempt.errorsAttemptedToFix.length - 5} more errors`);
      }
      lines.push('**⚠️ DO NOT REPEAT THIS APPROACH!**');
    }
    
    return lines.join('\n');
  }).join('\n');
  
  return formatted;
}

/**
 * Plan Node
 * 
 * Task-level planning: Generate execution plan for current task
 * Also handles dynamic task queue management when errors occur
 * 
 * Responsibilities:
 * 1. Check retry limit - if exceeded, create error task and move on
 * 2. Pop next task from queue
 * 3. If retry with errors: Analyze and potentially add error tasks to queue
 * 4. Generate execution plan for current task
 */
export async function plan(state: ArchitectGraphState): Promise<ArchitectGraphState> {
  const llm = state.deps?.llm as LLMClient;
  const engine = state.deps?.promptEngine as PromptEngine;

  const enforcementReason = state.enforcementReason;
  const isRetry = Boolean(enforcementReason);
  
  // ===== DETERMINE WHICH TASK TO EXECUTE =====
  let nextTask: Task | undefined;
  
  if (isRetry && state.currentTask) {
    // ✅ RETRY: Use the same task that failed
    nextTask = state.currentTask;
    console.log(`\n🔄 Retrying failed task: ${nextTask.name}`);
    console.log(`   Type: ${nextTask.type}, Priority: ${nextTask.priority}`);
    console.log(`   Retries: ${state.retries}/${state.maxRetries}`);
    console.log(`   Violations: ${state.violations?.length || 0}`);
    console.log(`   Queue size: ${state.taskQueue?.size() || 0} remaining\n`);
  } else {
    // ✅ NEW TASK: Pop from queue
    nextTask = state.taskQueue?.pop();
    
    if (!nextTask) {
      console.log('✅ Task queue is empty!');
      return state;
    }
    
    console.log(`\n🎯 Next task from queue: ${nextTask.name}`);
    console.log(`   Type: ${nextTask.type}, Priority: ${nextTask.priority}`);
    console.log(`   Queue size: ${state.taskQueue?.size() || 0} remaining\n`);
  }
  
  // ===== CHECK RETRY LIMIT (Priority Check) =====
  if (isRetry && state.retries >= state.maxRetries) {
    console.log(`\n⚠️  ═══════════════════════════════════════════════════════════`);
    console.log(`⚠️  Task "${nextTask.name}" EXHAUSTED RETRIES (${state.retries}/${state.maxRetries})`);
    console.log(`⚠️  ═══════════════════════════════════════════════════════════\n`);
    
    // Format violations for error task
    const violations = state.violations || [];
    const violationsText = violations.map((v, idx) => {
      const parts = [`${idx + 1}. [${v.severity}] ${v.type}: ${v.message}`];
      if (v.file) parts.push(`   File: ${v.file}`);
      if (v.module) parts.push(`   Module: ${v.module}`);
      if (v.suggestedFix) parts.push(`   Suggested: ${v.suggestedFix}`);
      return parts.join('\n');
    }).join('\n\n');
    
    // 1. Create error task from violations
    if (violations.length > 0) {
      const errorTask: Task = {
        id: `error-${nextTask.id}-${Date.now()}`,
        name: `Fix Errors: ${nextTask.name}`,
        type: 'error',
        priority: TASK_PRIORITIES.ERROR_TYPE,  // Default to type errors
        description: `Fix validation errors from "${nextTask.name}":\n\n${violationsText}`,
        errors: violations.map(v => v.message),
        validationRequired: true,
        validationType: 'runtime',
      };
      
      state.taskQueue?.push(errorTask);
      console.log(`📝 Created error task: "${errorTask.name}" (P${errorTask.priority})`);
      console.log(`   This error task will run AFTER all feature tasks\n`);
    }
    
    // 2. Mark feature task as complete (with errors deferred)
    if (nextTask.type === 'feature' && state.featureTasks) {
      const feature = state.featureTasks.get(nextTask.id);
      if (feature) {
        feature.completed = true;
        console.log(`✅ Marked feature task as complete (errors deferred to error task)`);
      }
    }
    
    // 3. Add to completed tasks
    state.completedTasks = state.completedTasks || [];
    if (!state.completedTasks.includes(nextTask.id)) {
      state.completedTasks.push(nextTask.id);
    }
    
    console.log(`⏭️  Moving to next task in queue...\n`);
    
    // 4. Clear enforcement state and pop next task
    const newNextTask = state.taskQueue?.pop();
    if (!newNextTask) {
      console.log('✅ Task queue is empty!');
      return {
        ...state,
        enforcementReason: undefined,
        violations: [],
        retries: 0,
      };
    }
    
    console.log(`🎯 Next task: ${newNextTask.name} (P${newNextTask.priority})\n`);
    nextTask = newNextTask;
    
    // Clear enforcement state for new task
    return {
      ...state,
      currentTask: nextTask,
      enforcementReason: undefined,
      violations: [],
      retries: 0,
    };
  }
  
  // ===== HANDLE ERRORS: Analyze & Add Error Tasks =====
  if (isRetry && state.violations && state.violations.length > 0) {
    console.log(`🔍 Analyzing errors from failed attempt...\n`);
    
    const violations = state.violations;
    
    // ===== RETRY HEURISTIC: 재시도 가능 여부 판단 =====
    const allRetryable = violations.every(v => v.isRetryable === true);
    const hasBlockingErrors = violations.some(v => 
      v.type === 'missing_dependency' || 
      v.type === 'missing_file' || 
      v.type === 'config_error'
    );
    
    if (allRetryable && !hasBlockingErrors) {
      console.log('✅ All errors are retryable (ellipsis, etc.) - will regenerate\n');
      // ⚠️ DO NOT clear enforcementReason! Execute node needs it!
      return {
        ...state,
        currentTask: nextTask,
        // Keep enforcementReason for Execute node!
      };
    }
    
    console.log('⚠️  Blocking errors detected - creating error task and deferring...\n');
    
    // Format violations for error task
    const violationsText = violations.map((v, idx) => {
      const parts = [`${idx + 1}. [${v.severity}] ${v.type}: ${v.message}`];
      if (v.file) parts.push(`   File: ${v.file}`);
      if (v.module) parts.push(`   Module: ${v.module}`);
      if (v.suggestedFix) parts.push(`   Suggested: ${v.suggestedFix}`);
      return parts.join('\n');
    }).join('\n\n');
    
    // Determine error priority based on violation types
    let errorPriority: number = TASK_PRIORITIES.ERROR_OTHER;
    if (violations.some(v => v.type === 'missing_file')) {
      errorPriority = TASK_PRIORITIES.ERROR_MISSING_ENTRY;
    } else if (violations.some(v => v.type === 'missing_dependency')) {
      errorPriority = TASK_PRIORITIES.ERROR_MISSING_DEPS;
    } else if (violations.some(v => v.type === 'config_error')) {
      errorPriority = TASK_PRIORITIES.ERROR_CONFIG;
    } else if (violations.some(v => v.type === 'type_error')) {
      errorPriority = TASK_PRIORITIES.ERROR_TYPE;
    } else if (violations.some(v => v.type === 'import_error')) {
      errorPriority = TASK_PRIORITIES.ERROR_IMPORT;
    } else if (violations.some(v => v.type === 'build_error')) {
      errorPriority = TASK_PRIORITIES.ERROR_BUILD;
    } else if (violations.some(v => v.type === 'syntax_error')) {
      errorPriority = TASK_PRIORITIES.ERROR_SYNTAX;
    } else if (violations.some(v => v.type === 'lint_error')) {
      errorPriority = TASK_PRIORITIES.ERROR_LINT;
    }
    
    // 1. Create error task immediately
    const errorTask: Task = {
      id: `error-${nextTask.id}-${Date.now()}`,
      name: `Fix Errors: ${nextTask.name}`,
      type: 'error',
      priority: errorPriority,
      description: `Fix blocking errors from "${nextTask.name}":\n\n${violationsText}`,
      errors: violations.map(v => v.message),
      validationRequired: true,
      validationType: 'runtime',
    };
    
    state.taskQueue?.push(errorTask);
    console.log(`📝 Created error task: "${errorTask.name}" (P${errorTask.priority})`);
    console.log(`   Priority: ${errorPriority} (Error tasks run AFTER all feature tasks)`);
    console.log(`   Violations: ${violations.length}`);
    
    // 2. Mark feature task as complete (with errors deferred)
    if (nextTask.type === 'feature' && state.featureTasks) {
      const feature = state.featureTasks.get(nextTask.id);
      if (feature) {
        feature.completed = true;
        console.log(`   ✅ Marked feature task as complete (errors deferred)`);
      }
    }
    
    // 3. Add to completed tasks
    state.completedTasks = state.completedTasks || [];
    if (!state.completedTasks.includes(nextTask.id)) {
      state.completedTasks.push(nextTask.id);
    }
          
    // 4. Update enforcement feedback
          if (state.enforcementHistory && state.enforcementHistory.length > 0) {
            const lastFeedback = state.enforcementHistory[state.enforcementHistory.length - 1];
            lastFeedback.fixStrategy = 'add_tasks';
      lastFeedback.addedTasks = [errorTask];
          }
          
    console.log(`⏭️  Moving to next feature task...\n`);
          
    // 5. Pop next task (should be next feature task)
    const newNextTask = state.taskQueue?.pop();
    if (!newNextTask) {
      console.log('✅ Task queue is empty!');
      return {
        ...state,
        enforcementReason: undefined,
        violations: [],
        retries: 0,
      };
    }
    
    console.log(`🎯 Next task: ${newNextTask.name} (P${newNextTask.priority})\n`);
    nextTask = newNextTask;
      
    // Clear enforcement state for new task
    return {
      ...state,
      currentTask: nextTask,
      enforcementReason: undefined,
      violations: [],
      retries: 0,
    };
  }
  
  if (!nextTask) {
    console.log('⚠️  No task to execute');
    return state;
  }
  
  // ===== CHECK IF TASK CHANGED (e.g. switched to error task) =====
  const taskChanged = !isRetry || (state.currentTask?.id !== nextTask.id);
  const shouldClearEnforcement = taskChanged && isRetry;
  
  if (shouldClearEnforcement) {
    console.log('⚠️  Task switched - clearing enforcement context for new task\n');
  }
  
  // ===== RELOAD CODE IF NOT SETUP TASK =====
  // ✅ CRITICAL: Reload working directory code for feature/error tasks
  // Setup task has no files yet, but feature tasks need to see what was created
  // 
  // ✅ OPTIMIZATION: Skip reload if resuming from session
  // - Decompose already reloaded code from disk when restoring session
  // - This prevents duplicate file loading and ensures consistency
  let currentCode = state.code;
  
  const isResuming = Boolean(state.completedTasks && state.completedTasks.length > 0);
  const shouldReload = nextTask.type !== 'setup' && !isResuming;
  
  if (shouldReload) {
    console.log(`📂 Reloading current codebase for task: ${nextTask.name}`);
    
    const gitPort = state.deps?.git;
    if (!gitPort) {
      throw new Error("GitPort not provided for file operations");
    }
    
    // ✅ Load ALL existing files (we're in early stage, files are few)
    // This ensures LLM sees what's already created and doesn't regenerate
    try {
      // Get all files, excluding build artifacts and dependencies
      const allFiles = await gitPort.listFiles('', [
        'node_modules',
        'dist',
        'build',
        'package-lock.json',
        'yarn.lock',
        'pnpm-lock.yaml',
        '.git',
        '*.test.ts',
        '*.test.tsx',
        '*.spec.ts',
        '*.spec.tsx'
      ]);
      
      // Load all files into a formatted string
      const fileContents: string[] = [];
      let totalTokens = 0;
      
      for (const file of allFiles.slice(0, 50)) {  // Max 50 files
        try {
          const content = await gitPort.readFile(file);
          if (content && content.length > 0) {
            fileContents.push(`=== ${file} ===\n${content}\n`);
            totalTokens += Math.ceil(content.length / 4);
            
            if (totalTokens > 100000) break;  // Token limit
          }
        } catch (error) {
          // Skip files that can't be read
        }
      }
      
      currentCode = fileContents.join('\n');
      console.log(`   ✅ Loaded ${fileContents.length} files (~${totalTokens} tokens)`);
    } catch (error) {
      console.warn(`⚠️  Could not load files: ${error}`);
      currentCode = state.code;  // Fallback to original
    }
  } else if (isResuming) {
    console.log(`⚡ Using code loaded by decompose (resume mode)\n`);
  }
  
  // ===== GENERATE EXECUTION PLAN FOR CURRENT TASK =====
  
  // Prepare artifacts
  const artifacts = {
    directive: state.directive,
    designDoc: state.design,
    prdSpec: state.prd,
    currentCode: currentCode,  // ✅ Use reloaded code
    originalFiles: state.codeHead,
    currentTask: nextTask ? {  // ✅ Pass current task info
      name: nextTask.name,
      type: nextTask.type,
      description: nextTask.description
    } : undefined
  };

  try {
    // Build prompt using PromptEngine with taskType
    const result = await engine.buildPlanPrompt(
      "code",
      state.context,
      artifacts,
      state.codeMode,
      nextTask.type  // Pass taskType to engine for language-specific constraints
    );

    let planText = '';
    
    console.log(`⏱️  Prompt build time: ${result.metadata.buildTime}ms`);
    console.log(`🎯 Inferred mode: ${result.modeConfig.mode}`);
    
    // If this is a retry of the SAME task, add retry context
    let promptMessages = result.formatted.messages;
    
    if (isRetry && enforcementReason && !shouldClearEnforcement) {
      const previousAttemptsText = formatPreviousAttempts(state.previousAttempts || []);
      
      // Format feature tasks reminder
      const featureReminder = state.featureTasks && state.featureTasks.size > 0 ? `
🎯 ORIGINAL FEATURE GOALS (DO NOT FORGET):
${Array.from(state.featureTasks.values()).map(f => 
  `  ${f.completed ? '✅' : '⏳'} ${f.name} - ${f.description}`
).join('\n')}
` : '';
      
      const taskContext = `
🎯 CURRENT TASK (${state.taskQueue?.size() || 0} tasks remaining after this):
  Name: ${nextTask.name}
  Type: ${nextTask.type} ${
    nextTask.type === 'setup' ? '(Config files only)' :
    nextTask.type === 'feature' ? '(Implement this feature)' : 
    '(Fix errors to unblock)'
  }
  Description: ${nextTask.description}
  ${nextTask.errors ? `Errors to fix: ${nextTask.errors.length}` : ''}

${
  nextTask.type === 'setup' ? '🔧 Generate configuration files ONLY (no application code)!' :
  nextTask.type === 'error' ? '⚠️ This is a BLOCKER task - fix quickly and correctly to resume feature implementation!' : 
  '🎯 Focus on implementing this feature properly!'
}
`;
      
      const retryContext = `
${featureReminder}
🔴 PREVIOUS ATTEMPT FAILED - VALIDATION ERRORS:

${enforcementReason}
${taskContext}
📝 PREVIOUS ATTEMPTS HISTORY (${state.previousAttempts?.length || 0} attempts):
${previousAttemptsText}

⚠️ CRITICAL: DO NOT REPEAT THE SAME APPROACH!
${nextTask.type === 'error' ? 
  'These are BLOCKING errors - fix them quickly and correctly.' : 
  'Work on the feature, but if errors occur, they will be handled separately.'}

🚫 FORBIDDEN ACTIONS:
1. ❌ Adding comments to JSON files (package.json, tsconfig.json)
2. ❌ Changing config to avoid missing files (CREATE the files instead)
3. ❌ Adding only main package without peer dependencies

📋 LEARN FROM FAILURES AND TRY A DIFFERENT APPROACH
`;
      
      promptMessages = result.formatted.messages.map((msg, idx) => {
        if (idx === promptMessages.length - 1 && msg.role === 'user') {
          return {
            ...msg,
            content: retryContext + '\n\n' + msg.content
          };
        }
        return msg;
      });
    }
    
    console.log('\n📝 Generating plan...\n');
    
    if (llm.stream) {
      for await (const chunk of llm.stream(promptMessages)) {
        process.stdout.write(chunk);
        try {
          // @ts-ignore
          if (typeof process.stdout._handle?.flush === 'function') {
            // @ts-ignore
            process.stdout._handle.flush();
          }
        } catch {}
        planText += chunk;
      }
      console.log('\n');
    } else {
      planText = await llm.invoke(promptMessages);
    }

    const codeMode = result.modeConfig.mode;

    console.log('\n✅ Plan generation complete');
    
    const updatedState = { 
      ...state,
      currentTask: nextTask,
      planText,
      codeMode,
      code: currentCode,  // ✅ Update state with reloaded files
      retries: shouldClearEnforcement ? 0 : state.retries,  // Reset only if new task
      enforcementReason: shouldClearEnforcement ? null : state.enforcementReason  // Clear only if new task
    };
    
    // ✅ Save checkpoint after planning (in case recursion limit hits during execute)
    const { saveCheckpoint } = await import('./checkpoint');
    await saveCheckpoint(updatedState);
    
    return updatedState;
  } catch (error) {
    console.error('\n❌ ═══════════════════════════════════════════════════════════════');
    console.error('❌ [Plan] CRITICAL ERROR - LLM API CALL FAILED');
    console.error('❌ ═══════════════════════════════════════════════════════════════\n');
    
    // Extract detailed error information (same logic as execute.ts)
    if (error && typeof error === 'object') {
      const apiError = error as any;
      
      if (apiError.error?.type) {
        const errorType = apiError.error.type;
        const errorMessage = apiError.error.message || 'Unknown error';
        
        switch (apiError.error.type) {
          case 'rate_limit_error':
            console.error('🚨 ERROR TYPE: RATE LIMIT EXCEEDED');
            console.error('📊 You have exceeded the API rate limit');
            console.error('⏰ Please wait 1-2 minutes and re-run. The agent will resume from the last checkpoint.\n');
            break;
            
          case 'overloaded':
            console.error('🚨 ERROR TYPE: API OVERLOADED');
            console.error('⚡ The API service is currently overloaded');
            console.error('⏰ Please wait 30-60 seconds and re-run. The agent will resume from the last checkpoint.\n');
            break;
            
          case 'insufficient_quota':
          case 'insufficient_funds':
            console.error('🚨 ERROR TYPE: INSUFFICIENT API QUOTA/CREDITS');
            console.error('💳 Your API account has insufficient credits');
            console.error('🔗 Please add credits to your Anthropic API account.\n');
            break;
            
          case 'invalid_api_key':
          case 'authentication_error':
            console.error('🚨 ERROR TYPE: AUTHENTICATION FAILED');
            console.error('🔑 API key is invalid or missing');
            console.error('⚙️  Please check your ANTHROPIC_API_KEY environment variable.\n');
            break;
            
          case 'api_error':
          default:
            console.error('🚨 ERROR TYPE: API ERROR');
            console.error(`📝 Message: ${errorMessage}\n`);
            break;
        }
        
        console.error('❌ Full error details:', JSON.stringify(error, null, 2));
      } else if (error instanceof Error) {
        console.error('🚨 ERROR TYPE: EXECUTION ERROR');
        console.error(`📝 Message: ${error.message}\n`);
        console.error('❌ Stack trace:', error.stack);
      }
    }
    
    console.error('❌ ═══════════════════════════════════════════════════════════════\n');
    
    throw error;
  }
}

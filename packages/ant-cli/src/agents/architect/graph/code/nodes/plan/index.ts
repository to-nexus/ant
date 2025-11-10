import { LLMClient } from "../../../../../../core/ports";
import { ArchitectGraphState, AttemptHistory, Task, Violation, TASK_PRIORITIES } from "../../state";
import { PromptEngine } from "../../../../../../core/prompt/engine";
import { streamLLMResponse, finalizeChatMessage } from "../shared/llmStreamHandler";
import { extractErrorDetails, createErrorViolation, logErrorHeader } from "../shared/errorHandler";

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
  // ✅ Workflow instrumentation: Enter node with current task info
  if (state.deps?.workflowUpdate && state._httpTaskId) {
    const taskInfo = state.currentTask ? {
      id: state.currentTask.id,
      name: state.currentTask.name,
      type: state.currentTask.type,
      description: state.currentTask.description,
      priority: state.currentTask.priority
    } : undefined;
    await state.deps.workflowUpdate.enterNode(state._httpTaskId, 'plan', taskInfo);
  }
  
  // ✅ Increment recursion count (track every node execution)
  state.recursionCount = (state.recursionCount || 0) + 1;
  
  console.log(`\n🧭 Planning (${state.recursionCount}/${state.recursionLimit || 50})`);
  
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
    console.log(`   Retries: ${state.retries}/${state.maxRetries}`);
    console.log(`   Violations: ${state.violations?.length || 0}\n`);
    
    // ✅ OPTIMIZATION: If retrying with existing plan, reuse it (skip LLM call)
    if (state.planText && !enforcementReason) {
      console.log(`⚡ Reusing existing plan from previous attempt\n`);
      
      // ✅ CRITICAL: If resuming from pause with lastViolations, reconstruct enforcementReason
      // This ensures execute.ts adds retry context with violation details
      let reconstructedEnforcementReason: string | undefined;
      if (state.lastViolations && state.lastViolations.length > 0) {
        console.log(`⚠️  Reconstructing enforcementReason from lastViolations (${state.lastViolations.length} violations)\n`);
        
        const violationsSummary = state.lastViolations
          .slice(0, 5)  // Limit to first 5 to avoid excessive context
          .map((v: any, idx: number) => `${idx + 1}. [${v.severity?.toUpperCase() || 'MAJOR'}] ${v.type}\n   Message: ${v.message}\n   💡 Suggested Fix: ${v.suggestedFix || 'Fix the error'}\n   ♻️  Retryable: ${v.isRetryable ? 'YES' : 'NO'}`)
          .join('\n\n');
        
        reconstructedEnforcementReason = violationsSummary;
      }
      
      return {
        ...state,
        currentTask: nextTask,
        enforcementReason: reconstructedEnforcementReason || state.enforcementReason,
      };
    }
  } else {
    // ✅ NEW TASK: Pop from queue
    // Save queue size BEFORE pop for accurate total count
    const remainingBeforePop = state.taskQueue?.size() || 0;
    nextTask = state.taskQueue?.pop();
    
    if (!nextTask) {
      console.log('✅ Task queue is empty!');
      return state;
    }
    
    // Calculate task type breakdown (including current task being executed)
    const tasksByType = {
      setup: 0,
      feature: 0,
      error: 0,
      final: 0
    };
    
    // Count remaining tasks in queue
    state.taskQueue?.getAll().forEach(task => {
      if (task.priority === 1000) {
        tasksByType.final++;
      } else if (task.type === 'error') {
        tasksByType.error++;
      } else if (task.type === 'setup') {
        tasksByType.setup++;
      } else if (task.type === 'feature') {
        tasksByType.feature++;
      }
    });
    
    // Add current task (just popped) to count
    if (nextTask.priority === 1000) {
      tasksByType.final++;
    } else if (nextTask.type === 'error') {
      tasksByType.error++;
    } else if (nextTask.type === 'setup') {
      tasksByType.setup++;
    } else if (nextTask.type === 'feature') {
      tasksByType.feature++;
    }
    
    const completedCount = state.completedTasks?.length || 0;
    const totalTasks = completedCount + remainingBeforePop;
    const queueTasks = state.taskQueue?.getAll() || [];
    
    console.log(`📊 Progress: ${completedCount}/${totalTasks} (${Math.round(completedCount / totalTasks * 100)}%) | Setup: ${tasksByType.setup} | Feature: ${tasksByType.feature} | Error: ${tasksByType.error}`);
    console.log(`🚀 Starting: ${nextTask.name} (${nextTask.type})`);
    if (remainingBeforePop > 1) {
      console.log(`   ${remainingBeforePop - 1} more task(s) in queue`);
    }
    
    // ✅ Update live task queue snapshot
    
    if (state._httpTaskId) {
      const completedTasksDetails = state.completedTasksDetails || [];
      
      if (state.deps?.kanbanUpdate) {
        // In-process: use injected port
        state.deps.kanbanUpdate.updateTaskQueue(
          state._httpTaskId,
          nextTask,
          queueTasks,
          completedTasksDetails,
          state.recursionCount,
          state.recursionLimit || 50
        );
      } else {
        // Child process: HTTP API fallback
        const serverPort = process.env.ANT_SERVER_PORT || '4100';
        try {
          // ✅ CRITICAL: await fetch to ensure update is sent before continuing
          const response = await fetch(`http://localhost:${serverPort}/api/internal/task-queue`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              taskId: state._httpTaskId,
              currentTask: nextTask,
              queue: queueTasks,
              completedTasks: completedTasksDetails,
              recursionCount: state.recursionCount,
              recursionLimit: state.recursionLimit || 50
            })
          });
        } catch (err: any) {
          // Silent fail for HTTP fallback
        }
      }
    }
  }
  
  // ===== CHECK RETRY LIMIT (Priority Check) =====
  if (isRetry && state.retries >= state.maxRetries) {
    console.log(`\n⚠️  ═══════════════════════════════════════════════════════════`);
    console.log(`⚠️  Task "${nextTask.name}" EXHAUSTED RETRIES (${state.retries}/${state.maxRetries})`);
    console.log(`⚠️  ═══════════════════════════════════════════════════════════\n`);
    
    const violations = state.violations || [];
    
    // Create error tasks from violations
    if (violations.length > 0) {
      const errorGroups = groupViolationsByType(violations);
      console.log(`📝 Creating ${errorGroups.length} error task(s) from ${violations.length} violation(s):\n`);
      
      errorGroups.forEach((group, idx) => {
        const errorPriority = getErrorPriorityByType(group.type);
        const errorTask: Task = {
          id: `error-${nextTask.id}-${group.type}-${Date.now()}-${idx}`,
          name: `Fix ${group.type.replace(/_/g, ' ').toUpperCase()} Errors`,
          type: 'error',
          priority: errorPriority,
          description: formatErrorDescription(group.violations),
          errors: group.violations.map((v: any) => v.message),
          validationRequired: true,
          validationType: 'runtime',
        };
        state.taskQueue?.push(errorTask);
        console.log(`   ${idx + 1}. "${errorTask.name}" (P${errorTask.priority}) - ${group.violations.length} error(s)`);
      });
      console.log('');
    }
    
    // ✅ Task 유형별 처리
    if (nextTask.type === 'setup' || nextTask.type === 'feature') {
      // Setup/Feature → 실패 정보 저장 후 완료 처리
      // ✅ 단, Final Task (P1000)는 deferred 처리
      if (nextTask.priority === 1000) {
        // Final task → Deferred (큐 뒤로, retry count 초기화)
        console.log(`📋 Deferring Final Task "${nextTask.name}" (will retry after error tasks with fresh retry count)\n`);
        
        // ✅ Retry count는 큐에서 다시 꺼낼 때 초기화됨
        const deferredTask = { ...nextTask };
        state.taskQueue?.push(deferredTask);
      } else {
        // 일반 Setup/Feature → 완료 처리
        state.failedTasks = state.failedTasks || [];
        state.failedTasks.push({
          taskId: nextTask.id,
          taskName: nextTask.name,
          taskType: nextTask.type,
          priority: nextTask.priority,
          violations: violations,
          timestamp: new Date().toISOString()
        });
        
        // Feature task면 featureTasks에서도 완료 처리
        if (nextTask.type === 'feature' && state.featureTasks) {
          const feature = state.featureTasks.get(nextTask.id);
          if (feature) {
            feature.completed = true;
          }
        }
        
        // completedTasks에 추가 (IDs only)
        state.completedTasks = state.completedTasks || [];
        if (!state.completedTasks.includes(nextTask.id)) {
          state.completedTasks.push(nextTask.id);
        }
        
        // ✅ CRITICAL: completedTasksDetails에도 추가 (full task details)
        state.completedTasksDetails = state.completedTasksDetails || [];
        if (!state.completedTasksDetails.find(t => t.id === nextTask.id)) {
          state.completedTasksDetails.push(nextTask);
        }
        
        console.log(`✅ Task "${nextTask.name}" marked as completed (with errors deferred to error tasks)\n`);
        
        // ✅ CRITICAL: Save checkpoint immediately so completed task is not lost
        const { saveCheckpoint } = await import('../checkpoint');
        await saveCheckpoint(state);
        
        // ✅ Update live snapshot via injected port (Hexagonal Architecture compliant)
        if (state.deps?.kanbanUpdate && state._httpTaskId) {
          const queueTasks = state.taskQueue?.getAll() || [];
          const completedTasksDetails = state.completedTasksDetails || [];
          
          console.log(`\n🔥 [Plan - Retry Limit] Updating live Kanban after marking task as completed`);
          console.log(`   Failed task: ${nextTask.name}`);
          console.log(`   Total completed: ${completedTasksDetails.length}\n`);
          
          state.deps.kanbanUpdate.updateTaskQueue(
            state._httpTaskId,
            undefined,
            queueTasks,
            completedTasksDetails,
            state.recursionCount,
            state.recursionLimit || 50
          );
        }
      }
      
    } else if (nextTask.type === 'error') {
      // Error task → Deferred (큐 뒤로, priority 조정, retry count 초기화)
      console.log(`📋 Deferring Error Task "${nextTask.name}"\n`);
      
      // ✅ Priority 조정: 현재 큐의 max priority (Final 제외) + 1
      const allTasks = state.taskQueue?.getAll() || [];
      const nonFinalTasks = allTasks.filter((t: Task) => t.priority < 1000);
      
      if (nonFinalTasks.length > 0) {
        const maxPriority = Math.max(...nonFinalTasks.map((t: Task) => t.priority));
        const newPriority = maxPriority + 1;
        console.log(`   Adjusting priority: ${nextTask.priority} → ${newPriority} (after other tasks)\n`);
        
        const deferredTask = { ...nextTask, priority: newPriority };
        state.taskQueue?.push(deferredTask);
      } else {
        // 유일한 task → 즉시 재삽입 (retry=0)
        console.log(`   Only task remaining - retrying immediately with fresh retry count\n`);
        const deferredTask = { ...nextTask };
        state.taskQueue?.push(deferredTask);
      }
    }
    
    console.log(`⏭️  Moving to next task in queue...\n`);
    
    // 다음 태스크로
    const newNextTask = state.taskQueue?.pop();
    if (!newNextTask) {
      console.log('✅ Task queue is empty!');
      return {
        ...state,
        currentTask: undefined,
        enforcementReason: undefined,
        violations: [],
        retries: 0,
      };
    }
    
    // ✅ 일관된 task 시작 로그 형식
    console.log(``);
    console.log(`🚀 Starting task: "${newNextTask.name}"`);
    console.log(`   Type: ${newNextTask.type.toUpperCase()}`);
    console.log(`   Priority: P${newNextTask.priority}\n`);
    
    return {
      ...state,
      currentTask: newNextTask,
      enforcementReason: undefined,
      violations: [],
      retries: 0,
    };
  }
  
  // ===== HANDLE ERRORS: Analyze & Add Error Tasks =====
  if (isRetry && state.violations && state.violations.length > 0) {
    console.log(`🔍 Analyzing errors from failed attempt...\n`);
    
    const violations = state.violations;
    
    // ✅ 모든 에러가 retryable인 경우만 재시도
    const allRetryable = violations.every(v => v.isRetryable === true);
    const hasBlockingErrors = violations.some(v => 
      v.type === 'missing_dependency' || 
      v.type === 'missing_file' || 
      v.type === 'config_error'
    );
    
    if (allRetryable && !hasBlockingErrors) {
      console.log('✅ All errors are retryable (ellipsis, etc.) - will regenerate\n');
      
      const retryState = {
        ...state,
        currentTask: nextTask,
        completedTasksDetails: state.completedTasksDetails || [],  // ✅ Preserve completed tasks
        // Keep enforcementReason for Execute node!
      };
      
      // ✅ CRITICAL: Save checkpoint before retry (for recursion limit recovery)
      const { saveCheckpoint } = await import('../checkpoint');
      await saveCheckpoint(retryState);
      console.log(`💾 Checkpoint saved (retry ${state.retries + 1})\n`);
      
      return retryState;
    }
    
    // ✅ Blocking error도 더 이상 즉시 Error Task 생성 안함
    console.log('⚠️  Blocking errors detected - will be deferred to Final Verification\n');
    
    const retryState = {
      ...state,
      currentTask: nextTask,
      completedTasksDetails: state.completedTasksDetails || [],  // ✅ Preserve completed tasks
    };
    
    // ✅ CRITICAL: Save checkpoint before retry (for recursion limit recovery)
    const { saveCheckpoint } = await import('../checkpoint');
    await saveCheckpoint(retryState);
    console.log(`💾 Checkpoint saved (blocking errors, retry ${state.retries + 1})\n`);
    
    return retryState;
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
      // Get ChatAPI client for progress tracking
      const { getChatAPIClient } = await import('../../../../../../core/adapters/ChatAPIClient');
      const chatAPI = getChatAPIClient();
      
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
      
      const maxFiles = Math.min(allFiles.length, 50);
      
      // ✅ Send exploring status
      await chatAPI.addExploringStatus(0, maxFiles);
      
      // Load all files into a formatted string
      const fileContents: string[] = [];
      const loadedFiles: string[] = [];
      let totalTokens = 0;
      
      for (let i = 0; i < maxFiles; i++) {
        const file = allFiles[i];
        try {
          // ✅ Send progress update every 5 files
          if (i > 0 && i % 5 === 0) {
            await chatAPI.addExploringStatus(i, maxFiles);
          }
          
          const content = await gitPort.readFile(file);
          if (content && content.length > 0) {
            fileContents.push(`=== ${file} ===\n${content}\n`);
            loadedFiles.push(file);
            totalTokens += Math.ceil(content.length / 4);
            
            if (totalTokens > 100000) break;  // Token limit
          }
        } catch (error) {
          // Skip files that can't be read
        }
      }
      
      // ✅ Send explored result
      await chatAPI.addExploredResult(fileContents.length, totalTokens, loadedFiles);
      
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
    
    // Use common streaming handler with Chat integration
    const { raw, chatMessageStarted } = await streamLLMResponse(llm, promptMessages, {
      enableChat: true  // ✅ Plan 전략을 일반 응답으로 표시
    });
    planText = raw;
    console.log('\n');
    
    // Finalize chat message
    await finalizeChatMessage(chatMessageStarted);

    const codeMode = result.modeConfig.mode;

    console.log('\n✅ Plan generation complete');
    
    const updatedState = { 
      ...state,
      currentTask: nextTask,
      planText,
      codeMode,
      code: currentCode,  // ✅ Update state with reloaded files
      retries: shouldClearEnforcement ? 0 : state.retries,  // Reset only if new task
      enforcementReason: shouldClearEnforcement ? null : state.enforcementReason,  // Clear only if new task
      completedTasksDetails: state.completedTasksDetails || [],  // ✅ CRITICAL: Preserve completedTasksDetails from checkTaskStatus
      recursionCount: state.recursionCount,  // ✅ CRITICAL: Propagate recursion count
      recursionLimit: state.recursionLimit,  // ✅ CRITICAL: Propagate recursion limit
    };
    
    // ✅ Save checkpoint after planning (in case recursion limit hits during execute)
    const { saveCheckpoint } = await import('../checkpoint');
    await saveCheckpoint(updatedState);
    
    // ✅ Workflow instrumentation: Exit node (success path)
    if (state.deps?.workflowUpdate && state._httpTaskId) {
      state.deps.workflowUpdate.exitNode(state._httpTaskId, 'plan');
    }
    
    return updatedState;
  } catch (error) {
    logErrorHeader('Plan');
    
    // Extract detailed error information
    const errorDetails = extractErrorDetails(error);
    
    // Legacy error logging for backward compatibility
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
    
    // ✅ Workflow instrumentation: Exit node (error path)
    if (state.deps?.workflowUpdate && state._httpTaskId) {
      state.deps.workflowUpdate.exitNode(state._httpTaskId, 'plan');
    }
    
    throw error;
  }
}

/**
 * Utility functions for error task creation
 * (Imported from evaluate.ts to avoid circular dependencies)
 */

/**
 * Group violations by type
 */
function groupViolationsByType(violations: any[]): Array<{type: string, violations: any[]}> {
  const groups = new Map<string, any[]>();
  
  violations.forEach(v => {
    const type = v.type || 'other';
    if (!groups.has(type)) {
      groups.set(type, []);
    }
    groups.get(type)!.push(v);
  });
  
  return Array.from(groups.entries()).map(([type, violations]) => ({
    type,
    violations
  }));
}

/**
 * Get error priority by violation type
 */
function getErrorPriorityByType(type: string): number {
  const priorityMap: Record<string, number> = {
    'missing_file': TASK_PRIORITIES.ERROR_MISSING_ENTRY,
    'missing_dependency': TASK_PRIORITIES.ERROR_MISSING_DEPS,
    'config_error': TASK_PRIORITIES.ERROR_CONFIG,
    'type_error': TASK_PRIORITIES.ERROR_TYPE,
    'import_error': TASK_PRIORITIES.ERROR_IMPORT,
    'build_error': TASK_PRIORITIES.ERROR_BUILD,
    'syntax_error': TASK_PRIORITIES.ERROR_SYNTAX,
    'lint_error': TASK_PRIORITIES.ERROR_LINT,
  };
  
  return priorityMap[type] || TASK_PRIORITIES.ERROR_OTHER;
}

/**
 * Format error description for Error Task
 */
function formatErrorDescription(violations: any[]): string {
  return violations.map((v, idx) => {
    const parts = [`${idx + 1}. [${v.severity}] ${v.type}: ${v.message}`];
    if (v.file) parts.push(`   File: ${v.file}`);
    if (v.module) parts.push(`   Module: ${v.module}`);
    if (v.suggestedFix) parts.push(`   Suggested: ${v.suggestedFix}`);
    return parts.join('\n');
  }).join('\n\n');
}

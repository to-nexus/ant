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
 * 1. Pop next task from queue
 * 2. If retry with errors: Analyze and potentially add error tasks to queue
 * 3. Generate execution plan for current task
 */
export async function plan(state: ArchitectGraphState): Promise<ArchitectGraphState> {
  const llm = state.deps?.llm as LLMClient;
  const engine = state.deps?.promptEngine as PromptEngine;

  const enforcementReason = state.enforcementReason;
  const isRetry = Boolean(enforcementReason);
  
  // ===== POP NEXT TASK FROM QUEUE =====
  let nextTask = state.taskQueue?.pop();
  
  if (!nextTask) {
    console.log('✅ Task queue is empty!');
    return state;
  }
  
  console.log(`\n🎯 Next task from queue: ${nextTask.name}`);
  console.log(`   Type: ${nextTask.type}, Priority: ${nextTask.priority}`);
  console.log(`   Queue size: ${state.taskQueue?.size() || 0} remaining\n`);
  
  // ===== HANDLE ERRORS: Analyze & Add Error Tasks =====
  if (isRetry && state.violations && state.violations.length > 0) {
    console.log(`🔄 Task "${state.currentTask?.name}" failed, analyzing errors...\n`);
    
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
      // Just retry, no need to ask LLM
      return {
        ...state,
        currentTask: nextTask,
        retries: 0,
        enforcementReason: null
      };
    }
    
    console.log('⚠️  Blocking errors detected - analyzing for task decomposition...\n');
    
    // Format violations for LLM
    const violationsText = violations.map((v, idx) => {
      const parts = [
        `${idx + 1}. [${v.severity}] ${v.type}: ${v.message}`
      ];
      if (v.file) parts.push(`   File: ${v.file}`);
      if (v.module) parts.push(`   Module: ${v.module}`);
      if (v.suggestedFix) parts.push(`   Suggested: ${v.suggestedFix}`);
      return parts.join('\n');
    }).join('\n\n');
    
    const attemptsText = formatPreviousAttempts(state.previousAttempts || []);
    
    // Format current queue status
    const queueStatus = state.taskQueue?.getAll().map(t => 
      `[P${t.priority}] ${t.name} (${t.type})`
    ).join('\n') || '(empty)';
    
    // Format feature tasks status
    const featureStatus = Array.from(state.featureTasks?.values() || []).map(f =>
      `${f.completed ? '✅' : '⏳'} ${f.name}`
    ).join('\n') || '(none)';
    
    const errorAnalysisPrompt = `You are analyzing a failed task to decide next actions.

FAILED TASK: ${state.currentTask?.name} (${state.currentTask?.type})
DESCRIPTION: ${state.currentTask?.description}

ERRORS (${state.violations.length} total):
${violationsText}

PREVIOUS ATTEMPTS:
${attemptsText}

CURRENT QUEUE:
${queueStatus}

ORIGINAL FEATURE TASKS:
${featureStatus}

YOUR DECISION:
Analyze these errors and decide:

**Option A: ADD ERROR TASKS** (if errors block progress)
- Create high-priority error-fix tasks
- These will be executed BEFORE continuing other tasks
- Example: Missing deps, missing entry files

**Option B: RETRY CURRENT TASK** (if errors are minor)
- Just regenerate code with better instructions
- Example: Code has ellipsis, minor type errors

Return JSON ONLY:
{
  "action": "add_tasks" | "retry",
  "reason": "One sentence why",
  "newTasks": [
    {
      "id": "fix-deps-1",
      "name": "Fix Missing Dependencies",
      "type": "error",
      "priority": 90,
      "description": "Install react, react-dom, and peer dependencies",
      "errors": ["Cannot find module 'react'", ...]
    }
  ]
}

PRIORITY GUIDE for error tasks (USE THESE EXACT VALUES):
LOWER NUMBER = HIGHER PRIORITY (executes first)
- Missing entry files (index.html): ${TASK_PRIORITIES.ERROR_MISSING_ENTRY} (ERROR_MISSING_ENTRY) ← MOST CRITICAL
- Missing dependencies: ${TASK_PRIORITIES.ERROR_MISSING_DEPS} (ERROR_MISSING_DEPS)
- Config errors: ${TASK_PRIORITIES.ERROR_CONFIG} (ERROR_CONFIG)
- Type errors: ${TASK_PRIORITIES.ERROR_TYPE} (ERROR_TYPE)
- Import errors: ${TASK_PRIORITIES.ERROR_IMPORT} (ERROR_IMPORT)
- Build errors: ${TASK_PRIORITIES.ERROR_BUILD} (ERROR_BUILD)
- Syntax errors: ${TASK_PRIORITIES.ERROR_SYNTAX} (ERROR_SYNTAX)
- Lint errors: ${TASK_PRIORITIES.ERROR_LINT} (ERROR_LINT) ← LEAST CRITICAL

RULES:
- If action is "retry", newTasks can be empty
- Error task IDs must be unique (add counter if needed)
- Don't create tasks for trivial issues (ellipsis - just retry those)
- Use exact priority values from guide above`;

    try {
      const response = await llm.invoke([{ role: 'user', content: errorAnalysisPrompt }]);
      
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.log('⚠️  No JSON in response, will retry current task\n');
        
        // Update enforcement feedback
        if (state.enforcementHistory && state.enforcementHistory.length > 0) {
          const lastFeedback = state.enforcementHistory[state.enforcementHistory.length - 1];
          lastFeedback.fixStrategy = 'retry';
        }
      } else {
        const decision = JSON.parse(jsonMatch[0]);
        
        if (decision.action === 'add_tasks' && decision.newTasks && decision.newTasks.length > 0) {
          console.log(`\n📌 Adding ${decision.newTasks.length} error tasks to queue:`);
          console.log(`   Reason: ${decision.reason}\n`);
          
          // Add new error tasks
          decision.newTasks.forEach((task: Task) => {
            console.log(`   + [P${task.priority}] ${task.name}`);
            state.taskQueue?.push(task);
          });
          
          // Update enforcement feedback with added tasks
          if (state.enforcementHistory && state.enforcementHistory.length > 0) {
            const lastFeedback = state.enforcementHistory[state.enforcementHistory.length - 1];
            lastFeedback.fixStrategy = 'add_tasks';
            lastFeedback.addedTasks = decision.newTasks;
          }
          
          // Re-add current task (will be retried later)
          console.log(`   + [P${nextTask.priority}] ${nextTask.name} (re-queued for later)\n`);
          state.taskQueue?.push(nextTask);
          
          // Pop again (highest priority task)
          nextTask = state.taskQueue?.pop();
          
          if (nextTask) {
            console.log(`🎯 Now executing: ${nextTask.name} (priority: ${nextTask.priority})\n`);
          }
        } else {
          console.log(`\n🔄 Retrying current task: ${nextTask.name}`);
          console.log(`   Reason: ${decision.reason}\n`);
          
          // Update enforcement feedback
          if (state.enforcementHistory && state.enforcementHistory.length > 0) {
            const lastFeedback = state.enforcementHistory[state.enforcementHistory.length - 1];
            lastFeedback.fixStrategy = 'retry';
          }
        }
      }
    } catch (error) {
      console.error('❌ Failed to analyze errors:', error);
      console.log('⚠️  Falling back to retry current task\n');
      
      // Update enforcement feedback
      if (state.enforcementHistory && state.enforcementHistory.length > 0) {
        const lastFeedback = state.enforcementHistory[state.enforcementHistory.length - 1];
        lastFeedback.fixStrategy = 'retry';
      }
    }
  }
  
  if (!nextTask) {
    console.log('⚠️  No task to execute');
    return state;
  }
  
  // ===== GENERATE EXECUTION PLAN FOR CURRENT TASK =====
  
  // Prepare artifacts
  const artifacts = {
    directive: state.directive,
    designDoc: state.design,
    prdSpec: state.prd,
    currentCode: state.code,
    originalFiles: state.codeHead,
  };

  try {
    // Build prompt using PromptEngine
    const result = await engine.buildPlanPrompt(
      "code",
      state.context,
      artifacts,
      state.codeMode
    );

    let planText = '';
    
    console.log(`⏱️  Prompt build time: ${result.metadata.buildTime}ms`);
    console.log(`🎯 Inferred mode: ${result.modeConfig.mode}`);
    
    // If this is a retry, add retry context
    let promptMessages = result.formatted.messages;
    if (isRetry && enforcementReason) {
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
  Type: ${nextTask.type} ${nextTask.type === 'feature' ? '(Implement this feature)' : '(Fix errors to unblock)'}
  Description: ${nextTask.description}
  ${nextTask.errors ? `Errors to fix: ${nextTask.errors.length}` : ''}

${nextTask.type === 'error' ? 
  '⚠️ This is a BLOCKER task - fix quickly and correctly to resume feature implementation!' : 
  '🎯 Focus on implementing this feature properly!'}
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
    
    return { 
      ...state,
      currentTask: nextTask,
      planText,
      codeMode,
      retries: 0,  // Reset for new task
      enforcementReason: null
    };
  } catch (error) {
    console.error('❌ [Plan] Error occurred:', error);
    throw error;
  }
}

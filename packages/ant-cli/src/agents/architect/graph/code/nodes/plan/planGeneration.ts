/**
 * Plan Text Generation
 * 
 * Generates concrete implementation plan based on:
 * - Task description
 * - Retrieved code context
 * - Design documents
 */

import { LLMClient } from "../../../../../../core/ports";
import { ArchitectGraphState, TASK_PRIORITIES, Violation } from "../../state";
import { CodeTask } from "../../../../types/task";
import { formatViolations } from "../shared/violationFormatter";
import { logPrompt } from "../../../../../../core/utils/promptLogger";
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Select appropriate LLM based on task type
 * All nodes processing the same task use the same model
 */
async function selectLLMForTask(
  defaultLLM: LLMClient,
  task: CodeTask,
  state: ArchitectGraphState
): Promise<LLMClient> {
  // If no workspaceConfig, use default LLM
  if (!state.workspaceConfig) {
    return defaultLLM;
  }
  
  const { createLLMClient } = await import('../../../../../../periphery/adapters/llm/LLMClientFactory');
  
  // Determine model based on TASK type (not node type!)
  // All nodes processing this task will use the same model
  let taskType: 'error' | 'final' | 'setup' | 'default' = 'default';
  
  if (task.type === 'error') {
    taskType = 'error';
  } else if (task.type === 'setup') {
    taskType = 'setup';
  } else if (task.type === 'feature' && task.priority === TASK_PRIORITIES.FINAL_VERIFICATION) {
    taskType = 'final';
  }
  // All other tasks (feature with lower priority, tool, etc.) use 'default'
  
  return createLLMClient(
    'architect',
    undefined,
    { jobType: 'code', taskType },  // ✅ Pass taskType, not nodeType!
    state.workspaceConfig
  );
}

export async function generatePlanText(
  llm: LLMClient,
  task: CodeTask,
  state: ArchitectGraphState,
  projectCodeContext: any,
  referenceCodeContexts: any[],
  violations?: Violation[],
  uiDoc?: string  // ✅ UI spec/assets doc for UI-related tasks
): Promise<string> {
  const requiresPlan = 
    task.priority !== TASK_PRIORITIES.FINAL_VERIFICATION &&  
    task.type !== 'explain';
  
  if (!requiresPlan) {
    if (task.priority === TASK_PRIORITIES.FINAL_VERIFICATION) {
      console.log(`   ⊖ Final verification task - no plan needed`);
    } else if (task.type === 'explain') {
      console.log(`   ⊖ Explain task - no plan needed`);
    }
    return '';
  }
  
  if (!llm) {
    throw new Error('[Plan] LLM not available but plan is required');
  }
  
  // ✅ Select appropriate LLM based on task type
  const llmToUse = await selectLLMForTask(llm, task, state);
  
  const promptEngine = state.deps?.promptEngine;
  if (!promptEngine) {
    throw new Error('[Plan] PromptEngine not available');
  }
  
  console.log(`📝 [Plan] Generating implementation plan...`);
  
  const designDoc = state.design || '';
  
  // ✅ Format violations for retry context
  const violationsText = violations && violations.length > 0 
    ? formatViolations(violations) 
    : undefined;
  
  if (violationsText) {
    console.log(`⚠️  [Plan] Including retry context (${violations?.length} violation(s))`);
  }
  
  const prompt = await promptEngine.buildTaskPlanPrompt(
    task,
    state.directive || '',
    designDoc,
    projectCodeContext,
    violationsText,
    uiDoc  // ✅ Pass uiDoc for UI-related tasks
  );
  
  // ✅ Log prompt structure (not content)
  const jobId = state._httpJobId || 'unknown';
  if (state.context.featurePath) {
    try {
      await logPrompt(
        state.context.featurePath,
        jobId,
        'code',
        'plan-planGen',
        prompt.length,
        {
          taskId: task.id,
          taskName: task.name,
          templatePath: 'code/phases/plan/base-plan',
          usedTemplates: ['code/phases/plan/rules-plan'],
          injectedVariables: {
            taskName: task.name,
            taskType: task.type,
            taskDescription: task.description ? `[${task.description.length} chars]` : undefined,
            directive: state.directive ? `[${state.directive.length} chars]` : undefined,
            designDoc: designDoc ? `[${designDoc.length} chars]` : undefined,
            uiDoc: uiDoc ? `[${uiDoc.length} chars]` : undefined,
            hasProjectCodeContext: !!projectCodeContext,
            isRetry: !!violationsText,
          },
        }
      );
    } catch (logError) {
      console.warn(`⚠️  [Plan-PlanGen] Failed to log prompt:`, logError);
    }
  }
  
  // ✅ Use centralized LLM wrapper with automatic token tracking
  const { invokeWithTracking } = await import('../../../common/llmHelpers');
  const response = await invokeWithTracking(
    llmToUse,
    [{ role: 'user', content: prompt }],
    state as any,
    { temperature: 0.5, maxTokens: 2000 }
  );
  
  const planMatch = response.match(/<plan>([\s\S]*?)<\/plan>/);
  const planText = planMatch ? planMatch[1].trim() : response.trim();
  
  if (planText.length < 50) {
    throw new Error(`[Plan] Generated plan is too short (${planText.length} chars). This indicates plan generation failure.`);
  }
  
  console.log(`   ✅ Plan generated (${planText.length} chars)\n`);
  
  // ✅ Save planText to sessions directory for debugging
  await savePlanTextForDebug(state, task, planText);
  
  return planText;
}

/**
 * Save planText to sessions/plan-text directory for debugging
 * 
 * Saves to: {featurePath}/sessions/plan-text/{jobId}.md
 * All task plans for a job are appended to a single file.
 * 
 * @param state - Current graph state
 * @param task - Current task
 * @param planText - Generated plan text
 */
async function savePlanTextForDebug(
  state: ArchitectGraphState,
  task: CodeTask,
  planText: string
): Promise<void> {
  try {
    const featurePath = state.context.featurePath;
    const jobId = state._httpJobId;
    
    if (!featurePath || !jobId) {
      return; // No feature path or jobId available
    }
    
    // Create sessions/plan-text/ directory
    const planTextDir = path.join(featurePath, 'sessions', 'plan-text');
    await fs.mkdir(planTextDir, { recursive: true });
    
    const filepath = path.join(planTextDir, `${jobId}.md`);
    
    // Check if file exists to determine header
    let existingContent = '';
    try {
      existingContent = await fs.readFile(filepath, 'utf-8');
    } catch {
      // File doesn't exist, will create with header
    }
    
    // Determine if this is a replan (retry)
    const retryCount = state.retries || 0;
    const isReplan = retryCount > 0;
    const replanLabel = isReplan ? ` (Replan #${retryCount})` : '';
    
    // Build entry for this task
    const separator = existingContent ? '\n\n---\n\n' : '';
    const header = existingContent ? '' : `# Plans Log (Job: ${jobId})\n\n`;
    
    const entry = `## ${task.name}${replanLabel}

- **Task ID**: ${task.id}
- **Type**: ${task.type}
- **Priority**: ${task.priority}
- **Retry**: ${retryCount}${isReplan ? ' ⚠️ REPLAN' : ''}
- **Generated**: ${new Date().toISOString()}

${planText}`;
    
    // Append to file
    await fs.writeFile(filepath, header + existingContent + separator + entry, 'utf-8');
    console.log(`   📄 Plan appended: sessions/plan-text/${jobId}.md`);
  } catch (err) {
    // Non-blocking - just log warning
    console.warn(`   ⚠️  Could not save plan for debug:`, err instanceof Error ? err.message : err);
  }
}

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
  
  return planText;
}

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
import { LLM_TEMPERATURE, LLM_MAX_TOKENS } from "../../../common/llmConfig";
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Select appropriate LLM for plan node
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
  
  return createLLMClient(
    'architect',
    undefined,
    { jobType: 'code', nodeType: 'plan' },
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
  
  const designDoc = state.design || '';
  
  // Format violations for retry context
  const violationsText = violations && violations.length > 0 
    ? formatViolations(violations) 
    : undefined;
  
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
    { temperature: LLM_TEMPERATURE.PLAN_GENERATION, maxTokens: LLM_MAX_TOKENS.PLAN }
  );
  
  // ✅ Extract <plan> tag content (REQUIRED - structured JSON output)
  const planMatch = response.match(/<plan>([\s\S]*?)<\/plan>/);
  
  if (!planMatch) {
    console.error(`❌ [Plan] <plan> tag not found in LLM response`);
    console.error(`   Response preview: "${response.substring(0, 200)}..."`);
    throw new Error(`[Plan] <plan> tag not found. LLM must output structured plan within <plan>...</plan> tags.`);
  }
  
  const planText = planMatch[1].trim();
  
  // Validate JSON structure (basic check)
  try {
    JSON.parse(planText);
  } catch (jsonError) {
    // Continue anyway - CodeGen can still use the structured text
  }
  
  if (planText.length < 50) {
    throw new Error(`[Plan] Generated plan is too short (${planText.length} chars). This indicates plan generation failure.`);
  }
  
  // ✅ Save planText to sessions directory for debugging
  await savePlanTextForDebug(state, task, planText);
  
  return planText;
}

/**
 * Save planText to sessions/debug/plans directory for debugging
 * 
 * Saves to: {featurePath}/sessions/debug/plans/{jobId}.json
 * All task plans for a job are stored in a single JSON file.
 * 
 * @param state - Current graph state
 * @param task - Current task
 * @param planText - Generated plan text (JSON string)
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
    
    // Create sessions/debug/plans/ directory
    const planTextDir = path.join(featurePath, 'sessions', 'debug', 'plans');
    await fs.mkdir(planTextDir, { recursive: true });
    
    const filepath = path.join(planTextDir, `${jobId}.json`);
    
    // Load existing plans array or create new
    let plansArray: any[] = [];
    try {
      const existing = await fs.readFile(filepath, 'utf-8');
      plansArray = JSON.parse(existing);
    } catch {
      // File doesn't exist, start fresh
    }
    
    // Determine if this is a replan (retry)
    const retryCount = state.retries || 0;
    
    // Parse planText JSON (or use raw if invalid)
    let planJson: any;
    try {
      planJson = JSON.parse(planText);
    } catch {
      planJson = { raw: planText };
    }
    
    // Build entry for this task
    const entry = {
      taskId: task.id,
      taskName: task.name,
      taskType: task.type,
      priority: task.priority,
      retry: retryCount,
      generated: new Date().toISOString(),
      plan: planJson
    };
    
    plansArray.push(entry);
    
    // Save as JSON
    await fs.writeFile(filepath, JSON.stringify(plansArray, null, 2), 'utf-8');
  } catch (err) {
    // Non-blocking - plan save failed
  }
}

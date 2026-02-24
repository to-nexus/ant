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
import { collectResolvedPartials } from "../../../../../../periphery/adapters/prompt/FilePromptAdapter";
import { LLM_TEMPERATURE, LLM_MAX_TOKENS, LLM_THINKING_BUDGET } from "../../../../../common/graph/llmConfig";
import { buildDesignDocForTask } from "../detectEnvironment/designSelector";
import { getSessionDebugDir } from '../../../../../../core/utils/sessionPaths';
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

/**
 * Build plan prompt (shared by generatePlanText and plan-with-tools path).
 */
export async function buildPlanPrompt(
  state: ArchitectGraphState,
  task: CodeTask,
  projectCodeContext: any,
  violationsText: string | undefined,
  uiDoc: string | undefined,
  remainingTasks: Array<{ id: string; name: string; description: string; priority: number }> | undefined
): Promise<string> {
  const promptEngine = state.deps?.promptEngine;
  if (!promptEngine) throw new Error('[Plan] PromptEngine not available');

  let designDoc: string;
  if (state.selectedSpec && state.specDocs?.[state.selectedSpec]) {
    // Spec-driven mode: use spec as primary, api-contract only as supplementary
    const parts: string[] = [];
    parts.push(`# Feature Specification (Primary)\n\n${state.specDocs[state.selectedSpec]}`);
    if (state.designDocs?.apiContract) {
      parts.push(`# API Contract (Reference)\n\n${state.designDocs.apiContract}`);
    }
    designDoc = parts.join('\n\n────────────────────────────────────────\n\n');
    console.log(`📋 [Plan] Using spec doc "${state.selectedSpec}" as primary (${designDoc.length} chars)`);
  } else if (task.packages && task.packages.length > 0 && state.designDocs) {
    designDoc = buildDesignDocForTask(task.packages, state.designDocs);
  } else {
    designDoc = state.design || '';
  }

  return promptEngine.buildTaskPlanPrompt(
    task,
    state.directive || '',
    designDoc,
    projectCodeContext,
    violationsText,
    uiDoc,
    state.profile,
    remainingTasks
  );
}

/**
 * Determine whether a task requires plan text generation.
 * Tasks that skip planning: verification, testgen, doc, explain, and final verification.
 */
export function taskRequiresPlan(task: CodeTask): boolean {
  return (
    task.priority !== TASK_PRIORITIES.FINAL_VERIFICATION &&
    task.type !== 'verification' &&
    task.type !== 'testgen' &&
    task.type !== 'doc' &&
    task.type !== 'explain'
  );
}

export async function generatePlanText(
  llm: LLMClient,
  task: CodeTask,
  state: ArchitectGraphState,
  projectCodeContext: any,
  referenceCodeContexts: any[],
  violations?: Violation[],
  uiDoc?: string,  // ✅ UI spec/assets doc for UI-related tasks
  remainingTasks?: Array<{ id: string; name: string; description: string; priority: number }>  // ✅ Remaining tasks for cross-task awareness
): Promise<string> {
  if (!taskRequiresPlan(task)) {
    return '';
  }
  
  if (!llm) {
    throw new Error('[Plan] LLM not available but plan is required');
  }
  
  const llmToUse = await selectLLMForTask(llm, task, state);
  const violationsText = violations && violations.length > 0 ? formatViolations(violations) : undefined;
  const prompt = await buildPlanPrompt(state, task, projectCodeContext, violationsText, uiDoc, remainingTasks);

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
          resolvedPartials: collectResolvedPartials(['code/phases/plan/base-plan', 'code/phases/plan/rules-plan']),
          injectedVariables: {
            taskName: task.name,
            taskType: task.type,
            taskDescription: task.description ? `[${task.description.length} chars]` : undefined,
            directive: state.directive ? `[${state.directive.length} chars]` : undefined,
            designDoc: state.designDocs ? '[split]' : undefined,
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
  const { invokeWithTracking, logTokenUsageToFile, getTaskTokenUsage, updateKanbanTokenUsage } = await import('../../../../../common/graph/llmHelpers');
  const beforeUsage = getTaskTokenUsage(state as any);
  const response = await invokeWithTracking(
    llmToUse,
    [{ role: 'user', content: prompt }],
    state as any,
    { temperature: LLM_TEMPERATURE.PLAN_GENERATION, maxTokens: LLM_MAX_TOKENS.DEFAULT, enableThinking: true, thinkingBudget: LLM_THINKING_BUDGET.PLAN }
  );
  updateKanbanTokenUsage(state as any);

  // Log to debug/tokens/
  const afterUsage = getTaskTokenUsage(state as any);
  const planCallUsage = {
    inputTokens: afterUsage.inputTokens - beforeUsage.inputTokens,
    outputTokens: afterUsage.outputTokens - beforeUsage.outputTokens,
    cacheReadTokens: (afterUsage.cacheReadTokens || 0) - (beforeUsage.cacheReadTokens || 0),
    cacheCreationTokens: (afterUsage.cacheCreationTokens || 0) - (beforeUsage.cacheCreationTokens || 0),
  };
  logTokenUsageToFile(
    state.context?.featurePath,
    state._httpJobId,
    planCallUsage as any,
    {
      taskId: state.currentTask?.id || 'unknown',
      taskName: state.currentTask?.name || 'unknown',
      node: 'plan-planGen',
      callIndex: 0,
      conversationHistoryLength: 0,
      projectCodeContextFiles: state.projectCodeContext?.files?.length || 0,
      estimatedPromptChars: prompt.length,
      taskCumulativeInput: beforeUsage.inputTokens,
      taskCumulativeOutput: beforeUsage.outputTokens,
      recursionCount: state.recursionCount,
    }
  );

  // ✅ Extract <plan> tag content (REQUIRED - structured JSON output)
  const planMatch = response.match(/<plan>([\s\S]*?)<\/plan>/);
  
  if (!planMatch) {
    const hasOpenTag = response.includes('<plan>');
    const outputDelta = planCallUsage.outputTokens;
    const isTruncation = hasOpenTag || outputDelta >= LLM_MAX_TOKENS.DEFAULT - 500;

    if (isTruncation) {
      console.error(`❌ [Plan] OUTPUT TRUNCATED — response hit max_tokens limit (${outputDelta} output tokens, limit: ${LLM_MAX_TOKENS.DEFAULT})`);
      console.error(`   <plan> open tag found: ${hasOpenTag}, response ends with: "...${response.substring(response.length - 100)}"`);
    } else {
      console.error(`❌ [Plan] <plan> tag not found in LLM response`);
      console.error(`   Response preview: "${response.substring(0, 200)}..."`);
    }

    throw new Error(
      `[Plan] <plan> tag not found. Your ENTIRE response must contain exactly one <plan>{JSON}</plan> block. ` +
      `Do NOT omit the <plan> tags. Do NOT output JSON without wrapping it in <plan>...</plan>.` +
      (isTruncation ? ` [TRUNCATION DETECTED: ${outputDelta} output tokens used, limit ${LLM_MAX_TOKENS.DEFAULT}]` : '')
    );
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
    
    // Create sessions/architect/debug/plans/ directory
    const planTextDir = getSessionDebugDir(featurePath, 'architect', 'plans');
    await fs.mkdir(planTextDir, { recursive: true });
    
    const filepath = path.join(planTextDir, `plan-${jobId}.json`);
    
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

/** Max plan↔tool round-trips before falling back to generatePlanText (no tools).
 * Reduced from 8: most productive exploration completes within 2-3 rounds.
 * Keeping 4 as a safety margin while preventing runaway token burn. */
export const PLAN_TOOL_LOOP_MAX = 4;

export type PlanWithToolsResult =
  | { planText: string }
  | { llmResponse: { toolCalls: Array<{ id: string; name: string; args: Record<string, any> }>; textResponse: string; thinking?: string; thinkingSignature?: string; done: false; tokenUsage?: any }; planConversationHistory: Array<{ role: 'user' | 'assistant'; content: string | any[] }>; _planExploring: true }
  | null;

/**
 * Run plan-phase LLM with tools (stream). Returns planText, or state updates for tool loop, or null to fallback to generatePlanText.
 */
export async function runPlanLLMWithTools(
  state: ArchitectGraphState,
  messages: Array<{ role: 'user' | 'assistant'; content: string | any[] }>,
  task: CodeTask
): Promise<PlanWithToolsResult> {
  const llm = state.deps?.llm as LLMClient | undefined;
  if (!llm?.stream) return null;

  const { getPlanTools } = await import('./getPlanTools');
  const tools = await getPlanTools(state);
  if (!tools?.length) return null;

  const llmToUse = await selectLLMForTask(llm, task, state);
  const toolCalls: Array<{ id: string; name: string; args: Record<string, any> }> = [];
  let textResponse = '';
  let thinking = '';
  let thinkingSignature = '';
  let tokenUsage: any = undefined;

  for await (const event of llmToUse.stream(messages, {
    tools,
    maxTokens: LLM_MAX_TOKENS.DEFAULT,
    enableThinking: true,
    thinkingBudget: LLM_THINKING_BUDGET.PLAN,
  })) {
    if (event.type === 'thinking') {
      thinking += (event as any).thinking ?? '';
      if (event.signature) {
        thinkingSignature = event.signature;
      }
    }
    if (event.type === 'tool_use' && (event as any).toolUse) {
      const { id, name, input } = (event as any).toolUse;
      toolCalls.push({ id, name, args: input ?? {} });
    }
    if (event.type === 'text') {
      textResponse += (event as any).text ?? '';
    }
    if (event.type === 'done' && (event as any).usage) {
      tokenUsage = (event as any).usage;
      const { accumulateTokenUsage, updateKanbanTokenUsage, logTokenUsageToFile } = await import('../../../../../common/graph/llmHelpers');
      accumulateTokenUsage(state as any, tokenUsage, { taskLevel: true, jobLevel: true });
      updateKanbanTokenUsage(state as any);
      // Log per-call token usage for plan-tool loop debugging
      const planRound = Math.floor((messages.length - 1) / 2);
      logTokenUsageToFile(
        state.context?.featurePath,
        state._httpJobId,
        tokenUsage,
        {
          taskId: state.currentTask?.id || 'unknown',
          taskName: state.currentTask?.name || 'unknown',
          node: 'plan-toolLoop',
          callIndex: planRound,
          conversationHistoryLength: messages.length,
          recursionCount: state.recursionCount,
        }
      );
    }
  }

  if (toolCalls.length > 0) {
    return {
      llmResponse: { toolCalls, textResponse, thinking: thinking || undefined, thinkingSignature: thinkingSignature || undefined, done: false, tokenUsage },
      planConversationHistory: messages,
      _planExploring: true,
    };
  }

  const planMatch = textResponse.match(/<plan>([\s\S]*?)<\/plan>/);
  if (planMatch) {
    const planText = planMatch[1].trim();
    if (planText.length >= 50) {
      return { planText };
    }
  }
  return null;
}

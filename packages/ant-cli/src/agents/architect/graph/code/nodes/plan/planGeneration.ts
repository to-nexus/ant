/**
 * Plan Text Generation
 * 
 * Generates concrete implementation plan based on:
 * - Task description
 * - Retrieved code context
 * - Design documents
 */

import { LLMClient } from "../../../../../../core/ports";
import { TextContentBlock, MessageContentBlock } from "../../../../../../core/ports/llm";
import { ArchitectGraphState, TASK_PRIORITIES, Violation } from "../../state";
import { CodeTask } from "../../../../types/task";
import { formatViolations } from "../shared/violationFormatter";
import { logPrompt } from "../../../../../../core/utils/promptLogger";
import { collectResolvedPartials } from "../../../../../../periphery/adapters/prompt/FilePromptAdapter";
import { LLM_TEMPERATURE, LLM_MAX_TOKENS, LLM_THINKING_BUDGET } from "../../../../../common/graph/llmConfig";
import { resolveDesignDocForTask } from "../documentResolver";
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
 * Resolve the designDoc string for a given task from state.
 * Shared by buildPlanPrompt and buildPlanPromptBlocks to guarantee identical output.
 * Delegates to resolveDesignDocForTask (documentResolver.ts).
 */
function resolveDesignDoc(state: ArchitectGraphState, task: CodeTask): string {
  return resolveDesignDocForTask(task, state);
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
  remainingTasks: Array<{ id: string; name: string; description: string; priority: number }> | undefined,
  options?: { hasTools?: boolean },
): Promise<string> {
  const promptEngine = state.deps?.promptEngine;
  if (!promptEngine) throw new Error('[Plan] PromptEngine not available');

  if (task.type === 'verification') {
    const profile = state.profile || (state as any).detectionReport?.profile;
    if (!profile) {
      console.warn(`⚠️ [Plan] Verification task "${task.name}": profile is null (state.profile=${!!state.profile}, detectionReport.profile=${!!(state as any).detectionReport?.profile})`);
    } else {
      console.log(`🔧 [Plan] Verification profile: language=${profile.language}, framework=${profile.framework || 'none'}`);
    }
    const installNeeded = state._installNeeded;
    let dependencyStatus: string | undefined;
    if (installNeeded === false) {
      dependencyStatus = 'Dependencies are current. Dependency declaration files are unchanged since last install. Skip dependency installation and proceed directly to build verification.';
    } else if (installNeeded === true) {
      dependencyStatus = 'Dependency declaration files have changed since last successful install. Run the project\'s install command before build verification.';
    }

    return await promptEngine.buildVerificationPlanPrompt(
      task,
      state.directive || '',
      projectCodeContext,
      violationsText,
      { hasTools: options?.hasTools ?? false },
      profile,
      dependencyStatus,
      state.resolvedAction,
    );
  }

  if (task.type === 'error') {
    const profile = state.profile || (state as any).detectionReport?.profile;
    return await promptEngine.buildErrorPlanPrompt(
      task,
      state.directive || '',
      projectCodeContext,
      violationsText,
      { hasTools: options?.hasTools ?? false },
      profile,
      state.resolvedAction,
    );
  }

  const designDoc = resolveDesignDoc(state, task);

  const prompt = await promptEngine.buildTaskPlanPrompt(
    task,
    state.directive || '',
    designDoc,
    projectCodeContext,
    violationsText,
    uiDoc,
    state.profile,
    remainingTasks,
    { hasTools: options?.hasTools ?? false },
    state.designDocUnknownPackages,
    !!state.selectedSpec,  // isSpecDriven
    state.resolvedAction,
  );

  return prompt;
}

/**
 * Build plan prompt as CacheableContent blocks for Anthropic prompt caching.
 *
 * The designDoc (typically 36K-126K chars) is stable within a plan-toolLoop
 * session, so placing it in a separate block with cache_control enables
 * Anthropic to cache it across successive tool-loop rounds.
 *
 * Used only by the plan-with-tools path (plan-toolLoop). The generatePlanText
 * path (single-shot, no tools) continues to use buildPlanPrompt directly.
 */
export async function buildPlanPromptBlocks(
  state: ArchitectGraphState,
  task: CodeTask,
  projectCodeContext: any,
  violationsText: string | undefined,
  uiDoc: string | undefined,
  remainingTasks: Array<{ id: string; name: string; description: string; priority: number }> | undefined,
  options?: { hasTools?: boolean },
): Promise<TextContentBlock[]> {
  const designDoc = resolveDesignDoc(state, task);
  const fullPrompt = await buildPlanPrompt(state, task, projectCodeContext, violationsText, uiDoc, remainingTasks, options);

  const blocks: TextContentBlock[] = [];

  // Anthropic requires ~1024 tokens minimum for caching; 3000 chars is a safe threshold
  if (designDoc && designDoc.length > 3000) {
    blocks.push({
      type: 'text',
      text: designDoc,
      cache_control: { type: 'ephemeral' },
    });
    const promptWithoutDesign = fullPrompt.replace(designDoc, '[See design document in previous block]');
    blocks.push({
      type: 'text',
      text: promptWithoutDesign,
    });
    console.log(`🔥 [Plan] Split prompt into cached designDoc (${designDoc.length} chars) + prompt (${promptWithoutDesign.length} chars)`);
  } else {
    blocks.push({
      type: 'text',
      text: fullPrompt,
      cache_control: { type: 'ephemeral' },
    });
  }

  return blocks;
}

/**
 * Determine whether a task requires plan text generation.
 * Tasks that skip planning: verification, test-code, doc, explain, and final verification.
 */
export function taskRequiresPlan(task: CodeTask): boolean {
  return (
    task.priority !== TASK_PRIORITIES.FINAL_VERIFICATION &&
    task.type !== 'verification' &&
    task.type !== 'test-code' &&
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
          templatePath: 'code/phases/plan/base',
          usedTemplates: ['code/phases/plan/rules'],
          resolvedPartials: collectResolvedPartials(['code/phases/plan/base', 'code/phases/plan/rules']),
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
  
  // ✅ UI streaming (aligned with decompose/execute pattern)
  const { getChatAPIClient } = await import('../../../../../../core/adapters/ChatAPIClient');
  const chatAPI = getChatAPIClient();
  await chatAPI.showChatStatus('placeholder');

  const { XMLStreamParser } = await import('../../../../../../core/streaming/parsers/XMLStreamParser');
  const { CommonRenderStrategy } = await import('../../../../../../core/streaming/strategies/CommonRenderStrategy');
  const { StreamOrchestrator } = await import('../../../../../../core/streaming/StreamOrchestrator');

  const createStrategy = () => {
    const strategy = new CommonRenderStrategy(chatAPI, 'en', undefined, undefined, false, 'code', undefined);
    strategy.setPlanTaskTitle(task.name);
    strategy.setParallelTaskName(task.name);
    return strategy;
  };

  let orchestrator = new StreamOrchestrator({
    parser: new XMLStreamParser(),
    renderStrategy: createStrategy(),
    existingFiles: new Set()
  });

  let response = '';
  let capturedUsage: any = undefined;

  for await (const event of llmToUse.stream(
    [{ role: 'user', content: prompt }],
    {
      temperature: LLM_TEMPERATURE.PLAN_GENERATION,
      maxTokens: LLM_MAX_TOKENS.DEFAULT,
      enableThinking: true,
      thinkingBudget: LLM_THINKING_BUDGET.PLAN,
    }
  )) {
    if (event.type === 'retry') {
      response = '';
      capturedUsage = undefined;
      orchestrator = new StreamOrchestrator({
        parser: new XMLStreamParser(),
        renderStrategy: createStrategy(),
        existingFiles: new Set()
      });
      continue;
    }

    await orchestrator.processEvent(event);

    if (event.text) {
      response += event.text;
    }

    if (event.type === 'done') {
      const { extractTokenUsageFromStreamEvent, accumulateTokenUsage, updateKanbanTokenUsage } = await import('../../../../../common/graph/llmHelpers');
      capturedUsage = extractTokenUsageFromStreamEvent(event);
      if (capturedUsage) {
        accumulateTokenUsage(state as any, capturedUsage, { taskLevel: true, jobLevel: true });
        updateKanbanTokenUsage(state as any);
      }
    }
  }

  await orchestrator.finalize();

  const { logTokenUsageToFile } = await import('../../../../../common/graph/llmHelpers');
  if (capturedUsage) {
    logTokenUsageToFile(
      state.context?.featurePath,
      state._httpJobId,
      capturedUsage,
      {
        taskId: state.currentTask?.id || 'unknown',
        taskName: state.currentTask?.name || 'unknown',
        node: 'plan-planGen',
        callIndex: 0,
        conversationHistoryLength: 0,
        projectCodeContextFiles: state.projectCodeContext?.files?.length || 0,
        estimatedPromptChars: prompt.length,
        taskCumulativeInput: 0,
        taskCumulativeOutput: 0,
        recursionCount: state.recursionCount,
      }
    );
  }

  // ✅ Extract <plan> tag content (REQUIRED - structured JSON output)
  const planMatch = response.match(/<plan>([\s\S]*?)<\/plan>/);
  
  if (!planMatch) {
    const hasOpenTag = response.includes('<plan>');
    const outputDelta = capturedUsage?.outputTokens || 0;
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
  
  // Validate JSON structure and prescribedPackages
  try {
    const parsed = JSON.parse(planText);
    validatePrescribedPackages(parsed, state);
  } catch (jsonError) {
    console.warn(`⚠️  [Plan] Failed to parse plan JSON for validation — prescribedPackages check skipped. Error: ${(jsonError as Error).message}`);
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

/**
 * Validate prescribedPackages structure within a single task plan.
 * Checks for missing field and declared-but-unused packages (empty usedBy).
 */
function validatePrescribedPackages(parsed: any, state: ArchitectGraphState): void {
  if (!state.designDocs || Object.keys(state.designDocs).length === 0) return;

  const prescribed: any[] | undefined = parsed.prescribedPackages;
  if (!prescribed || !Array.isArray(prescribed)) {
    console.warn(`⚠️  [Plan] prescribedPackages field missing — design docs exist but no packages declared`);
    return;
  }

  if (prescribed.length > 0) {
    const noUsage = prescribed.filter((p: any) => !p.usedBy?.length);
    if (noUsage.length > 0) {
      console.warn(`⚠️  [Plan] Prescribed packages declared but not used: ${noUsage.map((p: any) => p.package).join(', ')}`);
    }
    const emptyApis = prescribed.filter((p: any) => !p.apis || p.apis.length === 0);
    if (emptyApis.length > 0) {
      console.warn(`⚠️  [Plan] Prescribed packages with empty apis (signatures not discovered): ${emptyApis.map((p: any) => p.package).join(', ')}`);
    }
    console.log(`📦 [Plan] prescribedPackages: ${prescribed.map((p: any) => p.package).join(', ')}`);
  }

}

/** Max plan↔tool round-trips before forcing plan finalization.
 * After this many rounds the LLM is called once more WITHOUT tools
 * so it must produce a <plan> from the gathered exploration context. */
export const PLAN_TOOL_LOOP_MAX = 15;

export type PlanWithToolsResult =
  | { planText: string }
  | { llmResponse: { toolCalls: Array<{ id: string; name: string; args: Record<string, any> }>; textResponse: string; thinking?: string; thinkingSignature?: string; done: false; tokenUsage?: any }; planConversationHistory: Array<{ role: 'user' | 'assistant'; content: string | MessageContentBlock[] }>; _activePhase: 'plan' }
  | null;

/**
 * Run plan-phase LLM with tools (stream). Returns planText, or state updates for tool loop, or null to fallback to generatePlanText.
 */
export async function runPlanLLMWithTools(
  state: ArchitectGraphState,
  messages: Array<{ role: 'user' | 'assistant'; content: string | MessageContentBlock[] }>,
  task: CodeTask
): Promise<PlanWithToolsResult> {
  const llm = state.deps?.llm as LLMClient | undefined;
  if (!llm) {
    console.log('[Plan] runPlanLLMWithTools: llm not available, skipping tools');
    return null;
  }

  const { getPlanTools } = await import('./getPlanTools');
  const tools = await getPlanTools(state);
  if (!tools?.length) {
    console.log('[Plan] runPlanLLMWithTools: no tools available, skipping tools');
    return null;
  }

  const llmToUse = await selectLLMForTask(llm, task, state);
  if (!llmToUse?.stream) {
    console.log('[Plan] runPlanLLMWithTools: resolved LLM has no stream method, skipping tools');
    return null;
  }

  // ✅ UI streaming (aligned with decompose/execute pattern)
  const { getChatAPIClient } = await import('../../../../../../core/adapters/ChatAPIClient');
  const chatAPI = getChatAPIClient();
  await chatAPI.showChatStatus('placeholder');

  const { XMLStreamParser } = await import('../../../../../../core/streaming/parsers/XMLStreamParser');
  const { CommonRenderStrategy } = await import('../../../../../../core/streaming/strategies/CommonRenderStrategy');
  const { StreamOrchestrator } = await import('../../../../../../core/streaming/StreamOrchestrator');

  const createStrategy = () => {
    const strategy = new CommonRenderStrategy(chatAPI, 'en', undefined, undefined, false, 'code', undefined);
    strategy.setPlanTaskTitle(task.name);
    strategy.setParallelTaskName(task.name);
    return strategy;
  };

  let orchestrator = new StreamOrchestrator({
    parser: new XMLStreamParser(),
    renderStrategy: createStrategy(),
    existingFiles: new Set()
  });

  const toolCalls: Array<{ id: string; name: string; args: Record<string, any> }> = [];
  let textResponse = '';
  let thinking = '';
  let thinkingSignature = '';
  let tokenUsage: any = undefined;

  const isFirstRound = messages.length <= 1;
  for await (const event of llmToUse.stream(messages, {
    tools,
    maxTokens: LLM_MAX_TOKENS.DEFAULT,
    enableThinking: isFirstRound,
    thinkingBudget: isFirstRound ? LLM_THINKING_BUDGET.PLAN : undefined,
  })) {
    if (event.type === 'retry') {
      textResponse = '';
      thinking = '';
      thinkingSignature = '';
      toolCalls.length = 0;
      tokenUsage = undefined;
      orchestrator = new StreamOrchestrator({
        parser: new XMLStreamParser(),
        renderStrategy: createStrategy(),
        existingFiles: new Set()
      });
      continue;
    }

    await orchestrator.processEvent(event);

    if (event.type === 'thinking') {
      thinking += (event as any).thinking ?? '';
      if (event.signature) {
        thinkingSignature = event.signature;
      }
    }
    if (event.type === 'tool_use' && (event as any).toolUse) {
      const { id, name, input } = (event as any).toolUse;
      await chatAPI.sendLLMEvent(event);
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

  // Log prompt for plan-toolLoop so it appears in prompt-*.md debug files
  const isDiagnosticType = task.type === 'verification' || task.type === 'error';
  const planRound = Math.floor((messages.length - 1) / 2);
  const jobId = state._httpJobId || 'unknown';
  if (state.context?.featurePath) {
    try {
      const estimatedChars = messages.reduce(
        (n, m) => n + (typeof m.content === 'string' ? m.content.length : JSON.stringify(m.content).length), 0,
      );
      const logTemplate = task.type === 'verification'
        ? 'code/phases/plan/tasks/verification/rules'
        : task.type === 'error'
          ? 'code/phases/plan/tasks/error/base'
          : 'code/base/injections/plan-tools-batch';
      await logPrompt(
        state.context.featurePath,
        jobId,
        'code',
        `plan-toolLoop`,
        estimatedChars,
        {
          taskId: task.id,
          taskName: task.name,
          templatePath: 'plan-toolLoop (with tools)',
          usedTemplates: [logTemplate],
          resolvedPartials: collectResolvedPartials([logTemplate]),
          injectedVariables: {
            round: planRound,
            historyMessages: messages.length,
            toolCallsThisRound: toolCalls.length,
            toolNames: toolCalls.map(t => t.name),
            hasTextResponse: textResponse.length > 0,
          },
        },
      );
    } catch {
      // Non-blocking
    }
  }

  // Extract <plan> BEFORE checking tool calls.
  // LLMs may produce both a structured plan and tool calls in the same response.
  // Once a valid plan exists, additional tool calls (install, re-verify) are redundant —
  // execute applies fixes, then a fresh diagnostic cycle re-verifies.
  const planMatch = textResponse.match(/<plan>([\s\S]*?)<\/plan>/);
  if (planMatch) {
    const planText = planMatch[1].trim();
    if (planText.length >= 50) {
      await orchestrator.finalize();
      if (toolCalls.length > 0) {
        console.log(`📋 [Plan] <plan> extracted (${planText.length} chars) — ignoring ${toolCalls.length} concurrent tool call(s)`);
      }
      // Shortcut: if plan indicates no errors, return empty planText
      // so execute can immediately mark done without LLM interpretation
      if (isDiagnosticType) {
        try {
          const parsed = JSON.parse(planText);
          if (parsed.diagnostics?.totalErrors === 0 ||
              (parsed.implementation?.modify?.length === 0 &&
               parsed.implementation?.create?.length === 0 &&
               (parsed.implementation?.delete?.length ?? 0) === 0)) {
            console.log(`✅ [Plan] Diagnostic plan shows no errors — returning empty planText for immediate done`);
            return { planText: '' };
          }
        } catch { /* non-blocking parse error, use plan as-is */ }
      }
      return { planText };
    }
  }

  if (toolCalls.length > 0) {
    await orchestrator.finalize(true);
    return {
      llmResponse: { toolCalls, textResponse, thinking: thinking || undefined, thinkingSignature: thinkingSignature || undefined, done: false, tokenUsage },
      planConversationHistory: messages,
      _activePhase: 'plan' as const,
    };
  }

  await orchestrator.finalize();
  return null;
}

/**
 * Finalize plan from tool exploration context.
 *
 * Called when the plan↔tool loop hits PLAN_TOOL_LOOP_MAX. Instead of
 * discarding the conversation (which contains valuable tool results like
 * `go doc` output, file contents, etc.), this function makes ONE MORE
 * LLM call with the existing conversation history but WITHOUT tools,
 * forcing the LLM to synthesize a <plan> from what it has gathered.
 *
 * @returns planText string on success, null on failure (caller falls back to generatePlanText)
 */
export async function finalizePlanFromExploration(
  state: ArchitectGraphState,
  history: Array<{ role: 'user' | 'assistant'; content: string | MessageContentBlock[] }>,
  task: CodeTask,
): Promise<string | null> {
  const llm = state.deps?.llm as LLMClient | undefined;
  if (!llm || !history?.length) return null;

  const llmToUse = await selectLLMForTask(llm, task, state);
  if (!llmToUse?.stream) return null;

  const isDiagnostic = task.type === 'verification' || task.type === 'error';
  const finalizePrompt = isDiagnostic
    ? 'You have finished exploring and analyzing the codebase. Based on ALL the tool results above, ' +
      'produce your final diagnostic remediation plan NOW. Analyze all errors found, group by root cause, ' +
      'and output `<analysis>` followed by `<plan>{JSON}</plan>`. ' +
      'If 15 or more files need modification, use the BATCHED format: the JSON must contain a top-level "batches" array ' +
      'where each batch groups related fixes by root cause (with "name", "rationale", "modify", "create", "delete" fields). ' +
      'Otherwise use the single-plan format with an "implementation" object containing "modify", "create", "delete" arrays. ' +
      'Do NOT call any more tools. Your response MUST contain exactly one `<plan>` block.'
    : 'You have finished exploring. Based on ALL the tool results above, ' +
      'produce your final implementation plan NOW. Output `<analysis>` followed by `<plan>{JSON}</plan>`. ' +
      'Do NOT call any more tools. Your response MUST contain exactly one `<plan>` block.';

  const finalizeMessage: Array<{ role: 'user' | 'assistant'; content: string | MessageContentBlock[] }> = [
    ...history,
    {
      role: 'user' as const,
      content: finalizePrompt,
    },
  ];

  console.log(`📋 [Plan] Finalizing plan from exploration context (${history.length} messages)`);

  const { getChatAPIClient } = await import('../../../../../../core/adapters/ChatAPIClient');
  const chatAPI = getChatAPIClient();
  await chatAPI.showChatStatus('placeholder');

  const { XMLStreamParser } = await import('../../../../../../core/streaming/parsers/XMLStreamParser');
  const { CommonRenderStrategy } = await import('../../../../../../core/streaming/strategies/CommonRenderStrategy');
  const { StreamOrchestrator } = await import('../../../../../../core/streaming/StreamOrchestrator');

  const createStrategy = () => {
    const strategy = new CommonRenderStrategy(chatAPI, 'en', undefined, undefined, false, 'code', undefined);
    strategy.setPlanTaskTitle(task.name);
    strategy.setParallelTaskName(task.name);
    return strategy;
  };

  let orchestrator = new StreamOrchestrator({
    parser: new XMLStreamParser(),
    renderStrategy: createStrategy(),
    existingFiles: new Set(),
  });

  let textResponse = '';
  let tokenUsage: any = undefined;

  for await (const event of llmToUse.stream(finalizeMessage, {
    maxTokens: LLM_MAX_TOKENS.DEFAULT,
    enableThinking: true,
    thinkingBudget: LLM_THINKING_BUDGET.PLAN,
  })) {
    if (event.type === 'retry') {
      textResponse = '';
      tokenUsage = undefined;
      orchestrator = new StreamOrchestrator({
        parser: new XMLStreamParser(),
        renderStrategy: createStrategy(),
        existingFiles: new Set(),
      });
      continue;
    }

    await orchestrator.processEvent(event);

    if (event.type === 'text') {
      textResponse += (event as any).text ?? '';
    }
    if (event.type === 'done' && (event as any).usage) {
      tokenUsage = (event as any).usage;
      const { accumulateTokenUsage, updateKanbanTokenUsage, logTokenUsageToFile } = await import('../../../../../common/graph/llmHelpers');
      accumulateTokenUsage(state as any, tokenUsage, { taskLevel: true, jobLevel: true });
      updateKanbanTokenUsage(state as any);
      logTokenUsageToFile(
        state.context?.featurePath,
        state._httpJobId,
        tokenUsage,
        {
          taskId: task.id,
          taskName: task.name,
          node: 'plan-finalize',
          callIndex: 0,
          conversationHistoryLength: finalizeMessage.length,
          recursionCount: state.recursionCount,
        },
      );
    }
  }

  await orchestrator.finalize();

  // Log to prompt log for traceability
  const jobId = state._httpJobId || 'unknown';
  if (state.context?.featurePath) {
    try {
      await logPrompt(
        state.context.featurePath,
        jobId,
        'code',
        'plan-finalize',
        finalizeMessage.reduce((n, m) => n + (typeof m.content === 'string' ? m.content.length : JSON.stringify(m.content).length), 0),
        {
          taskId: task.id,
          taskName: task.name,
          templatePath: 'plan-finalize (from exploration)',
          usedTemplates: [],
          resolvedPartials: [],
          injectedVariables: {
            explorationRounds: Math.floor(history.length / 2),
            historyMessages: history.length,
          },
        },
      );
    } catch {
      // Non-blocking
    }
  }

  const planMatch = textResponse.match(/<plan>([\s\S]*?)<\/plan>/);
  if (planMatch) {
    const planText = planMatch[1].trim();
    if (planText.length >= 50) {
      console.log(`✅ [Plan] Finalized plan from exploration (${planText.length} chars)`);

      try {
        const parsed = JSON.parse(planText);
        validatePrescribedPackages(parsed, state);

        // Diagnostic shortcut: no errors → empty planText for immediate done
        if (isDiagnostic &&
            (parsed.diagnostics?.totalErrors === 0 ||
             (parsed.implementation?.modify?.length === 0 &&
              parsed.implementation?.create?.length === 0 &&
              (parsed.implementation?.delete?.length ?? 0) === 0))) {
          console.log(`✅ [Plan] Verification plan shows no errors — returning empty planText for immediate done`);
          await savePlanTextForDebug(state, task, planText);
          return '';
        }
      } catch { /* non-blocking */ }

      await savePlanTextForDebug(state, task, planText);
      return planText;
    }
  }

  console.warn(`⚠️ [Plan] finalizePlanFromExploration failed to produce valid <plan>, falling back`);
  return null;
}

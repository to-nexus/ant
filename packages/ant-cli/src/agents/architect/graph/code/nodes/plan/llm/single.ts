/**
 * `generatePlanText` — single-shot plan-LLM call (no tool-use).
 *
 * Used as the fallback when the task type doesn't enter the plan-with-tools
 * loop (i.e. `plan.usesToolLoop=false`).
 *
 * Streams an XML-tagged response and extracts the single `<plan>{...}</plan>`
 * block at the tail. Truncation diagnostics distinguish max-token cuts
 * from missing-tag protocol errors.
 */

import { LLMClient } from "../../../../../../../core/ports";
import { ArchitectGraphState, Violation } from "../../../state";
import { CodeTask } from "../../../../../types/task";
import { formatViolations } from "../../../utils/violationFormatter";
import { logPrompt } from "../../../../../../../core/utils/promptLogger";
import { collectResolvedPartials } from "../../../../../../../periphery/adapters/prompt/FilePromptAdapter";
import { LLM_TEMPERATURE, LLM_MAX_TOKENS, LLM_THINKING_BUDGET } from "../../../../../../common/graph/llmConfig";
import { maybeUpdatePhaseTokenUsage, applyEstimatedInputTokens } from "../../../../../../common/graph/llmHelpers";
import { buildPlanPrompt } from "./prompt";
import { selectLLMForTask } from "./selectModel";
import { savePlanTextForDebug } from "./savePlanText";
import { taskRequiresPlan } from "./requiresPlan";

export async function generatePlanText(
  llm: LLMClient,
  task: CodeTask,
  state: ArchitectGraphState,
  codeContext: any,
  violations?: Violation[],
  uiDoc?: string,  // ✅ UI spec/assets doc for UI-related tasks
  remainingTasks?: Array<{ id: string; name: string; description: string; priority: number }>,  // ✅ Remaining tasks for cross-task awareness
): Promise<string> {
  if (!taskRequiresPlan(task)) {
    return '';
  }

  if (!llm) {
    throw new Error('[Plan] LLM not available but plan is required');
  }

  const llmToUse = await selectLLMForTask(llm, task, state);
  const violationsText = violations && violations.length > 0 ? formatViolations(violations) : undefined;
  const { prompt, vars: hookVars } = await buildPlanPrompt(state, task, codeContext, violationsText, uiDoc, remainingTasks);

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
          templatePath: 'jobs/code/nodes/plan/base',
          usedTemplates: ['jobs/code/nodes/plan/rules'],
          resolvedPartials: collectResolvedPartials(['jobs/code/nodes/plan/base', 'jobs/code/nodes/plan/rules']),
          injectedVariables: {
            taskName: task.name,
            taskType: task.type,
            taskDescription: task.description ? `[${task.description.length} chars]` : undefined,
            directive: state.directive ? `[${state.directive.length} chars]` : undefined,
            include: task.include || undefined,
            packages: task.packages || undefined,
            hasProjectCodeContext: !!codeContext,
            isRetry: !!violationsText,
            // hook-supplied variant variables (verification / error /
            // extraTemplateVars-only bundles). Empty for the generic path.
            ...hookVars,
          },
        }
      );
    } catch (logError) {
      console.warn(`⚠️  [Plan-PlanGen] Failed to log prompt:`, logError);
    }
  }

  // ✅ UI streaming (aligned with decompose/execute pattern)
  const { getChatAPIClient } = await import('../../../../../../../core/adapters/ChatAPIClient');
  const chatAPI = getChatAPIClient();
  await chatAPI.showChatStatus('placeholder');

  const { XMLStreamParser } = await import('../../../../../../../core/streaming/parsers/XMLStreamParser');
  const { CommonRenderStrategy } = await import('../../../../../../../core/streaming/strategies/CommonRenderStrategy');
  const { StreamOrchestrator } = await import('../../../../../../../core/streaming/StreamOrchestrator');

  const createStrategy = () => {
    const strategy = new CommonRenderStrategy(chatAPI, 'en', undefined, undefined, false, 'code', undefined, undefined, undefined, undefined, 'plan');
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

  // R3: Provisional input-token estimate from prompt char-size. Overwritten
  // by the first `usage_partial` event from the LLM adapter.
  applyEstimatedInputTokens(state, prompt.length);

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

    // In-flight gauge update from usage_partial events (Anthropic/Gemini).
    // Overwrite-only; job/task counters are updated at 'done' below.
    maybeUpdatePhaseTokenUsage(state, event);

    await orchestrator.processEvent(event);

    if (event.text) {
      response += event.text;
    }

    if (event.type === 'done') {
      const { extractTokenUsageFromStreamEvent, accumulateTokenUsage, updateKanbanTokenUsage } = await import('../../../../../../common/graph/llmHelpers');
      capturedUsage = extractTokenUsageFromStreamEvent(event);
      if (capturedUsage) {
        accumulateTokenUsage(state, capturedUsage, { taskLevel: true, jobLevel: true });
        updateKanbanTokenUsage(state);
      }
    }
  }

  await orchestrator.finalize();

  const { logTokenUsageToFile } = await import('../../../../../../common/graph/llmHelpers');
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
        nodeHistoryLength: 0,
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

  if (planText.length < 50) {
    throw new Error(`[Plan] Generated plan is too short (${planText.length} chars). This indicates plan generation failure.`);
  }

  // ✅ Save planText to sessions directory for debugging
  await savePlanTextForDebug(state, task, planText);

  return planText;
}

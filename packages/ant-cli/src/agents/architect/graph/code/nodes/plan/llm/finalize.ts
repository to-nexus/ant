/**
 * `finalizePlanFromExploration` — last-chance plan synthesis when the
 * plan↔tool loop hit `PLAN_TOOL_LOOP_MAX`. Instead of discarding the
 * conversation (which contains valuable tool results like `go doc`
 * output, file contents, etc.), this function makes ONE MORE LLM call
 * with the existing conversation history but WITHOUT tools, forcing the
 * LLM to synthesize a `<plan>` from what it has gathered.
 *
 * `FINALIZE_NUDGE` is the default tail user message; per-task hooks
 * override it via `plan.finalizeNudge` when their initial prompt
 * surfaces multiple output formats (e.g. test-code's Format A / B).
 */

import { LLMClient } from "../../../../../../../core/ports";
import { MessageContentBlock } from "../../../../../../../core/ports/llm";
import { ArchitectGraphState } from "../../../state";
import { CodeTask } from "../../../../../types/task";
import { logPrompt } from "../../../../../../../core/utils/promptLogger";
import { LLM_MAX_TOKENS, LLM_THINKING_BUDGET } from "../../../../../../common/graph/llmConfig";
import { maybeUpdatePhaseTokenUsage, applyEstimatedInputTokensFromMessages } from "../../../../../../common/graph/llmHelpers";
import { hooksForTaskType } from "../../../tasks/_shared/registry";
import { selectLLMForTask } from "./selectModel";
import { savePlanTextForDebug } from "./savePlanText";

/**
 * Default finalize nudge used when no task-type-specific override exists.
 * Stops further tool calls and asks the LLM to synthesize a `<plan>` from
 * what it has gathered, following the format spec already in the initial
 * prompt. Task types whose initial prompt presents multiple output formats
 * (e.g. test-code's Format A / Format B) need to reinforce the decision
 * under finalize pressure — they publish `plan.finalizeNudge` to override
 * this default. Templates remain the SSOT for output schema; the override
 * only adds a decision-level reminder, never a schema redefinition.
 *
 * Exported so per-task-type tests can assert that hooks publishing their
 * own nudge do NOT accidentally return this default string.
 */
export const FINALIZE_NUDGE =
  'You have finished exploring. Do NOT call any more tools. ' +
  'Based on all tool results above, output exactly one `<plan>{JSON}</plan>` block ' +
  'following the format specified in the initial prompt.';

export async function finalizePlanFromExploration(
  state: ArchitectGraphState,
  history: Array<{ role: 'user' | 'assistant'; content: string | MessageContentBlock[] }>,
  task: CodeTask,
): Promise<string | null> {
  const llm = state.deps?.llm as LLMClient | undefined;
  if (!llm || !history?.length) return null;

  const llmToUse = await selectLLMForTask(llm, task, state);
  if (!llmToUse?.stream) return null;

  // R1 — single-line dispatch. NEVER inline `if (task.type === ...)` here;
  // task-type-specific finalize guidance lives behind `plan.finalizeNudge`.
  const nudge = hooksForTaskType(task.type)?.plan?.finalizeNudge?.({ task, state }) ?? FINALIZE_NUDGE;

  const finalizeMessage: Array<{ role: 'user' | 'assistant'; content: string | MessageContentBlock[] }> = [
    ...history,
    {
      role: 'user' as const,
      content: nudge,
    },
  ];

  console.log(`📋 [Plan] Finalizing plan from exploration context (${history.length} messages)`);

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
    existingFiles: new Set(),
  });

  let textResponse = '';
  let tokenUsage: any = undefined;

  // T1 pre-call estimate for the finalize pass.
  applyEstimatedInputTokensFromMessages(state, finalizeMessage);
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

    // In-flight gauge update from usage_partial events (Anthropic/Gemini).
    // Overwrite-only; job/task counters are updated at 'done' below.
    maybeUpdatePhaseTokenUsage(state, event);

    await orchestrator.processEvent(event);

    if (event.type === 'text') {
      textResponse += (event as any).text ?? '';
    }
    if (event.type === 'done' && (event as any).usage) {
      tokenUsage = (event as any).usage;
      const { accumulateTokenUsage, updateKanbanTokenUsage, logTokenUsageToFile } = await import('../../../../../../common/graph/llmHelpers');
      accumulateTokenUsage(state, tokenUsage, { taskLevel: true, jobLevel: true });
      updateKanbanTokenUsage(state);
      logTokenUsageToFile(
        state.context?.featurePath,
        state._httpJobId,
        tokenUsage,
        {
          taskId: task.id,
          taskName: task.name,
          node: 'plan-finalize',
          callIndex: 0,
          nodeHistoryLength: finalizeMessage.length,
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

      await savePlanTextForDebug(state, task, planText);
      return planText;
    }
  }

  console.warn(`⚠️ [Plan] finalizePlanFromExploration failed to produce valid <plan>, falling back`);
  return null;
}

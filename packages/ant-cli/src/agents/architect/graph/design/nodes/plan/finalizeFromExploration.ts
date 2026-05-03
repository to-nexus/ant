/**
 * `finalizeFromExploration` — last-chance plan synthesis when the
 * design plan↔tool loop hit the round-trip ceiling.
 *
 * Instead of discarding the conversation (which contains valuable
 * tool results — file reads, source-doc reads, Figma metadata), this
 * function makes ONE more LLM call WITHOUT tools, forcing the model
 * to synthesize a `<plan>` from gathered context. Mirrors the code-job
 * pattern in `code/nodes/plan/llm/finalize.ts`.
 *
 * Returns the planText, or null if the call did not produce a usable
 * `<plan>` block (caller falls through; the design plan node treats
 * fallthrough at this stage as a hard failure since design has no
 * single-shot fallback).
 */

import type { ConversationMessage } from '../../../../../common/graph/conversations';
import type { DesignGraphState } from '../../state';
import type { DesignTask } from '../../../../types/task';
import { LLM_MAX_TOKENS, LLM_THINKING_BUDGET } from '../../../../../common/graph/llmConfig';
import {
  applyEstimatedInputTokensFromMessages,
  maybeUpdatePhaseTokenUsage,
} from '../../../../../common/graph/llmHelpers';
import { extractPlanText } from '../../../../../common/graph/nodes/plan';
import { resolveLLMClient } from './llmClient';

const FINALIZE_NUDGE =
  'You have finished exploring. Do NOT call any more tools. ' +
  'Based on all tool results above, output exactly one `<plan>{JSON}</plan>` block ' +
  'following the format and rules specified in the initial prompt. ' +
  'Include at least two candidate solutions with explicit pros/cons.';

export async function finalizeFromExploration(
  state: DesignGraphState,
  history: ConversationMessage[],
  task: DesignTask,
): Promise<string | null> {
  if (!history?.length) return null;

  const llm = await resolveLLMClient(state);
  if (!llm?.stream) return null;

  const finalizeMessage = [
    ...(history as Array<{ role: 'user' | 'assistant'; content: any }>),
    { role: 'user' as const, content: FINALIZE_NUDGE },
  ];

  console.log(`📋 [DesignPlan] Finalizing plan from exploration context (${history.length} messages)`);

  const { getChatAPIClient } = await import('../../../../../../core/adapters/ChatAPIClient');
  const chatAPI = getChatAPIClient();
  await chatAPI.showChatStatus('placeholder');

  const { XMLStreamParser } = await import('../../../../../../core/streaming/parsers/XMLStreamParser');
  const { CommonRenderStrategy } = await import('../../../../../../core/streaming/strategies/CommonRenderStrategy');
  const { StreamOrchestrator } = await import('../../../../../../core/streaming/StreamOrchestrator');

  const createStrategy = () => {
    const strategy = new CommonRenderStrategy(chatAPI, 'en', undefined, undefined, false, 'design', undefined);
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

  applyEstimatedInputTokensFromMessages(state as any, finalizeMessage as any);

  for await (const event of llm.stream(finalizeMessage as any, {
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

    maybeUpdatePhaseTokenUsage(state as any, event);

    await orchestrator.processEvent(event);

    if (event.type === 'text') {
      textResponse += (event as any).text ?? '';
    }
    if (event.type === 'done' && (event as any).usage) {
      tokenUsage = (event as any).usage;
      const { accumulateTokenUsage, updateKanbanTokenUsage, logTokenUsageToFile } = await import(
        '../../../../../common/graph/llmHelpers'
      );
      accumulateTokenUsage(state as any, tokenUsage, { taskLevel: true, jobLevel: true });
      updateKanbanTokenUsage(state as any);
      logTokenUsageToFile(
        state.context?.featurePath,
        state._httpJobId,
        tokenUsage,
        {
          taskId: task.id,
          taskName: task.name,
          node: 'design-plan-finalize',
          callIndex: 0,
          nodeHistoryLength: finalizeMessage.length,
          recursionCount: state.recursionCount,
        },
      );
    }
  }

  await orchestrator.finalize();

  const planText = extractPlanText(textResponse, 50);
  if (planText !== null) {
    console.log(`✅ [DesignPlan] Finalized plan from exploration (${planText.length} chars)`);
    return planText;
  }

  console.warn(`⚠️ [DesignPlan] finalizeFromExploration failed to produce valid <plan>`);
  return null;
}

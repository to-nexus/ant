/**
 * `runPlanWithTools` — single-round plan-LLM stream driver shared by
 * code and design jobs.
 *
 * Responsibilities:
 *   1. Stream the LLM response with tools attached.
 *   2. Forward stream events to the StreamOrchestrator (XML parser +
 *      CommonRenderStrategy) so chat UI updates.
 *   3. Collect tool_use, text, thinking, and done events.
 *   4. On `done` → invoke caller's `onTokenUsage` hook (caller decides
 *      how to accumulate to its own state shape).
 *   5. Extract `<plan>...</plan>` from the gathered text. If found AND
 *      sufficiently long → return `{ kind: 'planText', planText }`.
 *   6. Otherwise, if any tool calls were collected → build the assistant
 *      message and return `{ kind: 'toolCalls', llmResponse, assistantMessage }`.
 *   7. Otherwise → return `null` (caller falls through to single-shot
 *      generation or treats as failure).
 *
 * NOT responsible for:
 *   - Prompt building (caller pre-builds `messages`).
 *   - Model selection (caller passes a pre-resolved `llm`).
 *   - Tool-set selection (caller passes pre-collected `tools`).
 *   - Conversation key management / history mutation.
 *   - Job-specific empty-plan shortcuts (code's `allowsEmptyImplShortcut`).
 *   - State mutation / routing decisions.
 *
 * The helper accepts a function-shaped argument record rather than a
 * class because code's plan node has 5 internal stages around this single
 * round (entry/shortcut/RAG/llm/outcome) while design's is lean — a
 * single class encapsulating both flows would force awkward methods on
 * one of the two callees. See README.md.
 */

import { applyEstimatedInputTokensFromMessages, maybeUpdatePhaseTokenUsage } from '../../llmHelpers';
import { buildAssistantMessage } from '../../../tool/messageBuilder';
import { extractPlanText } from './extractPlanText';
import type { PlanRoundResult, PlanToolCall, RunPlanWithToolsArgs, MinimalPlanState } from './types';

export async function runPlanWithTools<TState extends MinimalPlanState>(
  args: RunPlanWithToolsArgs<TState>,
): Promise<PlanRoundResult> {
  const {
    state,
    messages,
    llm,
    tools,
    enableThinking,
    thinkingBudget,
    maxTokens,
    taskName,
    jobType,
    onTokenUsage,
    onMaxTokensTruncation,
    minPlanLength = 50,
  } = args;

  if (!llm.stream) {
    console.log('[Plan] runPlanWithTools: resolved LLM has no stream method, skipping tools');
    return null;
  }
  if (!tools?.length) {
    console.log('[Plan] runPlanWithTools: no tools provided, skipping tools');
    return null;
  }

  const { getChatAPIClient } = await import('../../../../../core/adapters/ChatAPIClient');
  const chatAPI = getChatAPIClient();
  await chatAPI.showChatStatus('placeholder');

  const { XMLStreamParser } = await import('../../../../../core/streaming/parsers/XMLStreamParser');
  const { CommonRenderStrategy } = await import('../../../../../core/streaming/strategies/CommonRenderStrategy');
  const { StreamOrchestrator } = await import('../../../../../core/streaming/StreamOrchestrator');

  const createStrategy = () => {
    const strategy = new CommonRenderStrategy(chatAPI, 'en', undefined, undefined, false, jobType, undefined);
    strategy.setPlanTaskTitle(taskName);
    return strategy;
  };

  let orchestrator = new StreamOrchestrator({
    parser: new XMLStreamParser(),
    renderStrategy: createStrategy(),
    existingFiles: new Set(),
  });

  const toolCalls: PlanToolCall[] = [];
  let textResponse = '';
  let thinking = '';
  let thinkingSignature = '';
  let tokenUsage: any = undefined;
  let capturedStopReason: string | undefined;

  applyEstimatedInputTokensFromMessages(state as any, messages);

  for await (const event of llm.stream(messages, {
    tools,
    maxTokens,
    enableThinking,
    thinkingBudget: enableThinking ? thinkingBudget : undefined,
    // Hard-stop on `</plan>` so the model cannot emit trailing narrative
    // after sealing the JSON plan. Tool-call rounds (no `<plan>` emitted)
    // are unaffected — the stop string never appears.
    stopSequences: ['</plan>'],
  })) {
    if (event.type === 'retry') {
      textResponse = '';
      thinking = '';
      thinkingSignature = '';
      toolCalls.length = 0;
      tokenUsage = undefined;
      capturedStopReason = undefined;
      orchestrator = new StreamOrchestrator({
        parser: new XMLStreamParser(),
        renderStrategy: createStrategy(),
        existingFiles: new Set(),
      });
      continue;
    }

    maybeUpdatePhaseTokenUsage(state as any, event);

    await orchestrator.processEvent(event);

    if (event.type === 'thinking') {
      thinking += (event as any).thinking ?? '';
      if ((event as any).signature) {
        thinkingSignature = (event as any).signature;
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
      if (onTokenUsage) {
        // Awaited so async accumulators (token logger, kanban update,
        // file persistence) finish before the next stream event lands —
        // prevents `accumulateTokenUsage` racing with the next round's
        // `applyEstimatedInputTokensFromMessages` reseed.
        await onTokenUsage(tokenUsage);
      }
      // Truncation observation — the bare fact that we hit maxTokens.
      // Recovery is the caller's concern (caller falls through to a
      // fresh tool-loop today; chunked-emission recovery lives in C).
      const stopReason = (event as any).stopReason as string | undefined;
      capturedStopReason = stopReason;
      if (stopReason === 'max_tokens' && onMaxTokensTruncation) {
        const planRound = Math.floor((messages.length - 1) / 2);
        await onMaxTokensTruncation({
          outputTokens: tokenUsage?.outputTokens ?? maxTokens,
          round: planRound,
        });
      }
    }
  }

  // Normalize provider differences in stop_sequence handling — Anthropic
  // includes the matched sequence in the output; some Gemini SDK versions
  // strip it. When `</plan>` was the hard-stop and the run ended cleanly,
  // re-attach the close tag so `extractPlanText` matches.
  if (textResponse.includes('<plan>') && !textResponse.includes('</plan>')) {
    const cleanStop = capturedStopReason === 'stop_sequence' || capturedStopReason === 'end_turn';
    if (cleanStop) {
      console.log(`📋 [Plan] Re-attaching </plan> after clean stop (stop_reason=${capturedStopReason})`);
      textResponse += '</plan>';
    }
  }

  // Extract <plan> BEFORE checking tool calls. Models may emit both a
  // structured plan and tool calls in the same response; once a sealed
  // plan exists, additional tool calls are redundant — the next phase
  // (execute / docGen) will re-verify with its own tools.
  const planText = extractPlanText(textResponse, minPlanLength);
  if (planText !== null) {
    await orchestrator.finalize();
    if (toolCalls.length > 0) {
      console.log(
        `📋 [Plan] <plan> extracted (${planText.length} chars) — ignoring ${toolCalls.length} concurrent tool call(s)`,
      );
    }
    return { kind: 'planText', planText };
  }

  if (toolCalls.length > 0) {
    await orchestrator.finalize(true);
    const assistantMessage = buildAssistantMessage({
      thinking: thinking || undefined,
      thinkingSignature: thinkingSignature || undefined,
      text: textResponse || undefined,
      toolCalls,
    });
    return {
      kind: 'toolCalls',
      llmResponse: {
        toolCalls,
        textResponse,
        thinking: thinking || undefined,
        thinkingSignature: thinkingSignature || undefined,
        done: false,
        tokenUsage,
      },
      assistantMessage: assistantMessage as any,
    };
  }

  await orchestrator.finalize();
  return null;
}

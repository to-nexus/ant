/**
 * SubagentRunner — one in-process explore child.
 *
 * Never throws: every failure mode (LLM error, tool error, timeout, round
 * exhaustion, abort) becomes report content the parent LLM can act on. The
 * runner never touches graph state — usage is buffered on the registry entry
 * and folded at drain/join sites (see tokens.ts).
 */

import type { TaskTokenUsage, SubagentReportMetadata } from '@ant/shared';
import { getJobAbortSignal, isJobAborted } from '../../../composition/jobAbort';
import { LLM_TEMPERATURE } from '../graph/llmConfig';
import { createNoopChatStatusReporter } from '../tool/chatStatusAdapter';
import { unknownParamNotice } from '../tool/toolSchemas';
import {
  subagentMaxRounds,
  subagentMaxReportChars,
  subagentMaxReportPersistChars,
  subagentTimeoutMs,
  subagentMaxTokens,
  subagentReAskMaxTokens,
  subagentUnfinishedReportFloorChars,
} from './config';

/**
 * Textual tool-call markup leaked into the TEXT channel — observed when an
 * OpenAI-compat provider (GLM) keeps trying to call tools on the
 * toolChoice='none' final round and the server, told not to parse tool
 * tokens, streams them as plain text (slow-fleeing-camel RCA). Its presence
 * proves the response is an unfinished exploration turn, not a report.
 */
const TOOL_CALL_MARKUP_RE = /<tool_call\b|<arg_key>|<arg_value>/;

export function hasToolCallMarkup(text: string): boolean {
  return TOOL_CALL_MARKUP_RE.test(text);
}

/** Remove leaked tool-call blocks (each runs to the next block, an explicit close, or EOF). */
export function stripToolCallMarkup(text: string): string {
  return text.replace(/<tool_call\b[\s\S]*?(?:<\/tool_call>|(?=<tool_call\b)|$)/g, '').trim();
}

function mergeChildUsage(
  a: TaskTokenUsage | undefined,
  b: TaskTokenUsage | undefined,
): TaskTokenUsage | undefined {
  if (!a) return b;
  if (!b) return a;
  return {
    inputTokens: (a.inputTokens || 0) + (b.inputTokens || 0),
    outputTokens: (a.outputTokens || 0) + (b.outputTokens || 0),
    totalTokens: (a.totalTokens || 0) + (b.totalTokens || 0),
    cacheReadTokens: (a.cacheReadTokens || 0) + (b.cacheReadTokens || 0),
    cacheCreationTokens: (a.cacheCreationTokens || 0) + (b.cacheCreationTokens || 0),
  };
}
import { buildChildMessages } from './prompts';
import type { SubagentResult, SubagentSeamInternals } from './types';

export async function runExploreSubagent(params: {
  id: string;
  goal: string;
  hints?: string[];
  internals: SubagentSeamInternals;
  /** Launch card id minted by the handler — terminal card folds onto it. */
  chatCardId?: string;
}): Promise<SubagentResult> {
  const startedAt = Date.now();
  const startedAtIso = new Date(startedAt).toISOString();
  let rounds = 0;
  let result: SubagentResult;

  try {
    result = await runInner({ ...params, startedAt: startedAtIso }, (r) => {
      rounds = r;
    });
  } catch (err: unknown) {
    result = {
      report:
        `Exploration failed: ${(err as Error)?.message ?? String(err)}. ` +
        `Treat as no findings; re-issue explore or read directly if needed.`,
      rounds,
      state: 'error',
    };
  }

  await emitTerminalCard(params, result, Date.now() - startedAt);
  return result;
}

async function runInner(
  params: {
    id: string;
    goal: string;
    hints?: string[];
    internals: SubagentSeamInternals;
    chatCardId?: string;
    startedAt?: string;
  },
  onRound: (rounds: number) => void,
): Promise<SubagentResult> {
  const { internals } = params;
  const { createLLMClient } = await import('../../../periphery/adapters/llm/LLMClientFactory');
  const llm = createLLMClient(
    undefined,
    undefined,
    { jobType: internals.llmJobType as any, nodeType: 'subagent' },
    internals.workspaceConfig,
  );
  const modelId: string | undefined = (llm as any).modelName;

  if (!internals.promptBuilder) {
    return {
      report:
        'Exploration failed: prompt renderer unavailable in this context. ' +
        'Treat as no findings; read directly instead.',
      rounds: 0,
      state: 'error',
      modelId,
    };
  }
  const messages = await buildChildMessages(internals.promptBuilder, {
    ...params,
    toolNames: internals.childTools.map((t) => t.name),
  });

  // Depth-1 layer 2: the child's ctx cannot launch further children, and the
  // child is chat-silent (its only surface is the runner's card).
  const childCtx = {
    ...internals.baseCtx,
    chatStatus: createNoopChatStatusReporter(),
    subagent: undefined,
    currentToolCallId: undefined,
    // Explicit narrow stamp — the parent-ctx spread would leak the parent's
    // wider tool set into the child's cross-namespace redirects.
    availableToolNames: new Set(internals.registry.names()) as ReadonlySet<string>,
  };

  const toolHandler = async (name: string, args: Record<string, any>): Promise<string> => {
    const gate = internals.gate?.({ id: params.id, name, args });
    if (gate && gate.allowed === false) return gate.error;
    const handler = internals.registry.get(name);
    // Name the available set: a goal/hint authored by the parent may
    // prescribe tools from the PARENT's wider set, and without guidance the
    // child burns further rounds retrying surfaces it does not have.
    if (!handler) {
      return `Error: unknown tool '${name}'. Your available tools: ${internals.registry.names().join(', ')}.`;
    }
    const paramNotice = unknownParamNotice(name, args) ?? '';
    try {
      const res = await handler(childCtx as any, args);
      if (res.error) return (typeof res.content === 'string' ? res.content : res.error) + paramNotice;
      return (typeof res.content === 'string' ? res.content : JSON.stringify(res.content)) + paramNotice;
    } catch (err: unknown) {
      return `Error: ${(err as Error)?.message ?? String(err)}` + paramNotice;
    }
  };

  const { callLLMWithToolLoop } = await import('../llm/callLLMWithToolLoop');

  // Single wall-clock deadline shared by the main loop AND the corrective
  // re-ask below — the re-ask must stay inside the same budget or the
  // `joinTimeout (330s) > childTimeout (300s)` ordering inverts and the
  // parent's join barrier fires before the child's own bound.
  const deadline = Date.now() + subagentTimeoutMs();
  const raceAgainstDeadline = async <T>(work: Promise<T>): Promise<T | 'timeout'> => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return 'timeout';
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), remaining);
    });
    const raced = await Promise.race([work, timeout]);
    if (timer) clearTimeout(timer);
    return raced;
  };

  let roundCounter = 0;
  const runLoop = (
    loopMessages: Array<{ role: string; content: any }>,
    maxRounds: number,
    maxTokens: number,
  ) =>
    callLLMWithToolLoop(llm, loopMessages, internals.childTools, toolHandler, {
      temperature: LLM_TEMPERATURE.SUBAGENT_EXPLORE,
      maxTokens,
      maxRounds,
      silentChatCards: true,
      signal: getJobAbortSignal(),
      shouldAbort: isJobAborted,
      betweenRounds: async () => {
        roundCounter++;
        onRound(roundCounter);
        await emitProgressCard(params, roundCounter);
        // Early convergence notice: the loop's own budget warning lands only
        // on the second-to-last round — too late to change course. Three
        // rounds out gives the model room to stop widening and consolidate.
        const total = subagentMaxRounds();
        if (total - 3 > 0 && roundCounter === total - 3) {
          return [
            {
              type: 'text' as const,
              text: '[SYSTEM] 3 tool rounds remain — finish gathering and reserve the final round for your report.',
            },
          ];
        }
        return [];
      },
    });

  let raced = await raceAgainstDeadline(
    runLoop(messages, subagentMaxRounds(), subagentMaxTokens()),
  );

  if (raced === 'timeout') {
    // The loop keeps running detached until its own bounds fire; its usage is
    // lost for billing (bounded by maxRounds/maxTokens). Deliberate trade-off
    // — no cancellation channel exists for a mid-round provider stream.
    return {
      report: `[partial] Exploration timed out after ${Math.round(subagentTimeoutMs() / 1000)}s (goal: ${params.goal}). Findings up to the timeout were not recoverable.`,
      rounds: roundCounter,
      state: 'partial',
      modelId,
    };
  }

  // Corrective re-ask (once): all three failure shapes leave the accumulated
  // tool evidence intact in `finalMessages` — a degenerate round severed by
  // the in-stream breaker (lapis-oaring-drain RCA), a thinking-starved round
  // where reasoning consumed the whole output cap before any report text
  // (local-nursing-churn RCA), and a round-cap-exhausted final that narrated
  // the next tool intent (or leaked textual tool-call markup) instead of
  // reporting (slow-fleeing-camel RCA). A verbatim replay reproduces the same
  // failure — the re-ask names WHY the previous attempt failed and demands
  // the report from evidence already gathered. The reason is computed ONCE so
  // a re-ask that fails another way cannot chain into a second re-ask.
  const racedText = String(raced.response ?? '').trim();
  const reAskReason: 'degenerate' | 'starved' | 'unfinished' | null = !raced.finalMessages
    ? null
    : raced.degenerate
      ? 'degenerate'
      : !racedText && raced.stopReason === 'max_tokens'
        ? 'starved'
        : raced.exhausted &&
            (hasToolCallMarkup(racedText) ||
              racedText.length < subagentUnfinishedReportFloorChars())
          ? 'unfinished'
          : null;
  if (reAskReason && !isJobAborted()) {
    const reasonLabel =
      reAskReason === 'degenerate'
        ? 'Degenerate round severed'
        : reAskReason === 'starved'
          ? 'Report round starved by the output-token cap'
          : 'Round cap hit mid-exploration without a report';
    console.warn(`⚠️ [Subagent] ${reasonLabel} (id=${params.id}) — issuing one corrective re-ask`);
    const retryMessages = [
      ...raced.finalMessages!,
      {
        role: 'user' as const,
        content:
          reAskReason === 'degenerate'
            ? '[SYSTEM] Your previous response degenerated into repeating the same ' +
              'sentence and was discarded. Do NOT narrate further tool intentions. ' +
              'Write your COMPLETE final report NOW, from the evidence already ' +
              'gathered above, following your report contract.'
            : reAskReason === 'starved'
              ? '[SYSTEM] Your previous response was cut off by the output token cap ' +
                'before any report text was produced. Do NOT deliberate further. ' +
                'Write a CONCISE final report NOW, from the evidence already ' +
                'gathered above, following your report contract.'
              : '[SYSTEM] You ran out of tool rounds, and your previous response was ' +
                'mid-exploration narration or tool-call syntax, not a report — it was ' +
                'discarded. No tool calls remain. Write your COMPLETE final report ' +
                'NOW, from the evidence already gathered above, following your ' +
                'report contract.',
      },
    ];
    const priorUsage = raced.usage as TaskTokenUsage | undefined;
    // maxRounds=1 → the re-ask IS a forced-final round (toolChoice='none').
    // degenerate: reduced cap so a second degeneration is cheap. starved and
    // unfinished: the full cap — the whole report must fit.
    const reRaced = await raceAgainstDeadline(
      runLoop(
        retryMessages,
        1,
        reAskReason === 'degenerate' ? subagentReAskMaxTokens() : subagentMaxTokens(),
      ),
    );
    if (reRaced !== 'timeout') {
      raced = {
        ...reRaced,
        usage: mergeChildUsage(priorUsage, reRaced.usage as TaskTokenUsage | undefined),
        roundsUsed: roundCounter,
      };
    }
  }

  const { response, usage, roundsUsed, exhausted, aborted, stopReason } = raced;

  if (aborted) {
    return {
      report: `[partial] Exploration aborted by job stop (goal: ${params.goal}).`,
      usage: usage as TaskTokenUsage | undefined,
      rounds: roundsUsed,
      state: 'aborted',
      modelId,
    };
  }

  let report = (response || '').trim();
  // Leaked textual tool-call markup never reaches the parent conversation —
  // it is provider syntax, not findings. Reached only when the corrective
  // re-ask was skipped (non-exhausted rounds) or itself leaked markup. The
  // raw text is preserved on `reportFull` for the card/store forensics.
  let markupRaw: string | undefined;
  if (hasToolCallMarkup(report)) {
    console.warn(`⚠️ [Subagent] Tool-call markup leaked into report text (id=${params.id}) — stripping`);
    markupRaw = report;
    report = stripToolCallMarkup(report);
  }
  if (!report) {
    return {
      report:
        `Exploration produced no report` +
        (stopReason === 'max_tokens'
          ? ' (truncated at the output-token cap before any report text — the report did not fit the output budget)'
          : markupRaw
            ? ' (the response contained only leaked tool-call syntax)'
            : '') +
        ` (goal: ${params.goal}). Treat as no findings; re-issue explore with a narrower goal or read directly.`,
      ...(markupRaw !== undefined ? { reportFull: markupRaw } : {}),
      usage: usage as TaskTokenUsage | undefined,
      rounds: roundsUsed,
      state: 'error',
      modelId,
    };
  }

  // Viability gate — degenerate output must never reach the parent
  // conversation: repeated filler pollutes the parent context and has crashed
  // decompose downstream. Trips on the char-heuristic OR on the loop's
  // in-stream breaker flag (a severed partial can be too short for the
  // heuristic's 50-unit floor). Reached only when the corrective re-ask above
  // was skipped or itself degenerated. The raw text still goes to the report
  // store + chat card (`reportFull`) for forensics; only the parent-facing
  // body is replaced.
  const { assessReportViability } = await import('./assessReportViability');
  const viability = assessReportViability(report);
  if (viability.degenerate || raced.degenerate) {
    console.warn(
      `⚠️ [Subagent] Degenerate report gated (id=${params.id}, ` +
        `distinctRatio=${viability.distinctRatio.toFixed(3)}, units=${viability.totalUnits}, ` +
        `breakerSevered=${raced.degenerate === true}, ` +
        `stopReason=${stopReason ?? 'n/a'}) — replacing with failure notice`,
    );
    const { storeFullReport } = await import('./reportStore');
    storeFullReport(params.id, params.goal, report);
    return {
      report:
        `Exploration terminated abnormally: the model produced degenerate repetitive output` +
        (stopReason === 'max_tokens'
          ? ' (truncated at the output-token cap)'
          : raced.degenerate
            ? ' (severed by the repetition breaker)'
            : '') +
        ` instead of a report (goal: ${params.goal}). No usable findings — ` +
        `read the relevant files directly instead of re-issuing the same broad explore.`,
      reportFull: report,
      usage: usage as TaskTokenUsage | undefined,
      rounds: roundsUsed,
      state: 'error',
      modelId,
    };
  }

  // Over-budget reports are compacted (lead + structural outline + drill-down
  // notice), never blind-cut: the full text goes to the report store for the
  // `subagent_report` tool and to the chat card via `reportFull`. Compaction
  // is recoverable delivery compression, so it does NOT mark the run partial —
  // `partial` is reserved for genuinely incomplete exploration (exhaustion).
  let reportFull: string | undefined = markupRaw;
  const cap = subagentMaxReportChars();
  if (report.length > cap) {
    reportFull = report;
    const { storeFullReport } = await import('./reportStore');
    const { compactReport } = await import('./compactReport');
    storeFullReport(params.id, params.goal, report);
    report = compactReport(report, cap, params.id);
  }

  // Truncation is a validity signal, not a formatting detail — the parent
  // must know the tail is missing. Appended after compaction so head+tail
  // slicing cannot drop the notice.
  if (stopReason === 'max_tokens') {
    report += '\n\n[note] Output hit the token cap — the tail of this report is missing.';
  }

  // Store EVERY report (not just over-cap/degenerate): `subagent_report`
  // previously could never resolve an under-cap report, yet its miss message
  // asserted the inline form was complete — the parent had no way to re-read
  // a report it lost track of. The bounded FIFO in reportStore is the leak
  // guard; re-inserting an over-cap report refreshes its FIFO slot.
  {
    const { storeFullReport } = await import('./reportStore');
    storeFullReport(params.id, params.goal, reportFull ?? report);
  }

  return {
    report: exhausted ? `[partial] ${report}` : report,
    ...(reportFull !== undefined ? { reportFull } : {}),
    usage: usage as TaskTokenUsage | undefined,
    rounds: roundsUsed,
    state: exhausted ? 'partial' : 'done',
    modelId,
  };
}

async function emitProgressCard(
  params: { id: string; goal: string; chatCardId?: string; startedAt?: string },
  rounds: number,
): Promise<void> {
  if (!params.chatCardId) return;
  try {
    const { getChatAPIClient } = await import('../../../core/adapters/ChatAPIClient');
    await getChatAPIClient().subagentProgress(params.chatCardId, {
      subagentId: params.id,
      goal: params.goal,
      rounds,
      ...(params.startedAt ? { startedAt: params.startedAt } : {}),
    });
  } catch (err) {
    console.warn('⚠️ [Subagent] progress card emit failed:', (err as Error).message);
  }
}

async function emitTerminalCard(
  params: { id: string; goal: string; chatCardId?: string },
  result: SubagentResult,
  durationMs: number,
): Promise<void> {
  try {
    const { getChatAPIClient } = await import('../../../core/adapters/ChatAPIClient');
    const usage = result.usage
      ? {
          inputTokens: result.usage.inputTokens || 0,
          outputTokens: result.usage.outputTokens || 0,
          totalTokens: result.usage.totalTokens || 0,
        }
      : undefined;
    const meta: SubagentReportMetadata = {
      subagentId: params.id,
      goal: params.goal,
      rounds: result.rounds,
      state: result.state,
      // The card persists the FULL report (human drill-down surface) even when
      // the parent-facing inline form was compacted.
      report: (result.reportFull ?? result.report).slice(0, subagentMaxReportPersistChars()),
      ...(result.state === 'error' ? { error: result.report.slice(0, 300) } : {}),
      durationMs,
      usage,
    };
    await getChatAPIClient().subagentComplete(params.chatCardId, meta);
  } catch (err) {
    console.warn('⚠️ [Subagent] terminal card emit failed:', (err as Error).message);
  }
}

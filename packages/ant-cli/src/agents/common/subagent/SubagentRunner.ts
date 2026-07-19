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
import {
  subagentMaxRounds,
  subagentMaxReportChars,
  subagentMaxReportPersistChars,
  subagentTimeoutMs,
  subagentMaxTokens,
} from './config';
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
  const messages = await buildChildMessages(internals.promptBuilder, params);

  // Depth-1 layer 2: the child's ctx cannot launch further children, and the
  // child is chat-silent (its only surface is the runner's card).
  const childCtx = {
    ...internals.baseCtx,
    chatStatus: createNoopChatStatusReporter(),
    subagent: undefined,
    currentToolCallId: undefined,
  };

  const toolHandler = async (name: string, args: Record<string, any>): Promise<string> => {
    const gate = internals.gate?.({ id: params.id, name, args });
    if (gate && gate.allowed === false) return gate.error;
    const handler = internals.registry.get(name);
    if (!handler) return `Error: unknown tool '${name}'`;
    try {
      const res = await handler(childCtx as any, args);
      if (res.error) return typeof res.content === 'string' ? res.content : res.error;
      return typeof res.content === 'string' ? res.content : JSON.stringify(res.content);
    } catch (err: unknown) {
      return `Error: ${(err as Error)?.message ?? String(err)}`;
    }
  };

  const { callLLMWithToolLoop } = await import('../llm/callLLMWithToolLoop');

  let roundCounter = 0;
  const loop = callLLMWithToolLoop(llm, messages, internals.childTools, toolHandler, {
    temperature: LLM_TEMPERATURE.SUBAGENT_EXPLORE,
    maxTokens: subagentMaxTokens(),
    maxRounds: subagentMaxRounds(),
    silentChatCards: true,
    signal: getJobAbortSignal(),
    shouldAbort: isJobAborted,
    betweenRounds: async () => {
      roundCounter++;
      onRound(roundCounter);
      await emitProgressCard(params, roundCounter);
      return [];
    },
  });

  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), subagentTimeoutMs());
  });

  const raced = await Promise.race([loop, timeout]);
  if (timer) clearTimeout(timer);

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
  if (!report) {
    return {
      report: `Exploration produced no report (goal: ${params.goal}). Treat as no findings; re-issue explore with a narrower goal or read directly.`,
      usage: usage as TaskTokenUsage | undefined,
      rounds: roundsUsed,
      state: 'error',
      modelId,
    };
  }

  // Viability gate — degenerate output (repetition loops after the final
  // round's tool-strip) must never reach the parent conversation: 16k of
  // repeated filler pollutes the parent context and has crashed decompose
  // downstream. The raw text still goes to the report store + chat card
  // (`reportFull`) for forensics; only the parent-facing body is replaced.
  const { assessReportViability } = await import('./assessReportViability');
  const viability = assessReportViability(report);
  if (viability.degenerate) {
    console.warn(
      `⚠️ [Subagent] Degenerate report gated (id=${params.id}, ` +
        `distinctRatio=${viability.distinctRatio.toFixed(3)}, units=${viability.totalUnits}, ` +
        `stopReason=${stopReason ?? 'n/a'}) — replacing with failure notice`,
    );
    const { storeFullReport } = await import('./reportStore');
    storeFullReport(params.id, params.goal, report);
    return {
      report:
        `Exploration terminated abnormally: the model produced degenerate repetitive output` +
        (stopReason === 'max_tokens' ? ' (truncated at the output-token cap)' : '') +
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
  let reportFull: string | undefined;
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

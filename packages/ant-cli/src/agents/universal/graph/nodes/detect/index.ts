/**
 * Universal detect node — turn-context detection. The SINGLE writer of
 * `state.turnContext` (intents + @ctx paths + plan flag + provenance +
 * execution tier); downstream nodes read the confirmed object only.
 *
 * Intent inference is multi-label over the job's own catalog
 * (`ResolvedCustomJob.intents`, code-exterior data) and runs INSIDE the job
 * only: it gates injection inlining and never routes or switches jobs (job
 * identity is fixed by the composer's agent/job chips). Execution tier is
 * LLM-declared via `<executionTier>` — the canonical Tier Entry Node
 * contract (plan/visual: detect; code/design: decompose).
 *
 * Skip ladder (priority order, all decided inside the node):
 *   1. empty userMessage (resume without a new message) → keep restored
 *      context, zero LLM calls
 *   2. otherwise → one non-streaming LLM call (retry once) for the tier,
 *      and — unless intents are explicit or the catalog is empty — the
 *      intent labels. Failure floors: intents → ['general'], tier → Reflex.
 */

import { GENERAL_INTENT, ExecutionTierId } from '@ant/shared';
import type { UniversalGraphState, UniversalTurnContext } from '../../state';
import { CONV_KEYS, getConv, type ConversationMessage } from '../../../../common/graph/conversations';
import { LLM_TEMPERATURE } from '../../../../common/graph/llmConfig';
import { accumulateTokenUsage } from '../../../../common/graph/llmHelpers';
import { getJobAbortSignal } from '../../../../../composition/jobAbort';
import { extractLLMInfo } from '../../../../../core/ports/workflow';
import { TEMPLATE_PATHS } from '../../../../../core/prompt/builder/templatePaths';
import { requireActiveCustomJob } from '../../../../../core/customAgents/activeCustomJob';
import { emitExecutionTier } from '../../../../../core/streaming/emitExecutionTier';
import { parseDetectResponse } from './parser';

const RECENT_TURNS_MAX = 3;
const RECENT_TURN_CHARS = 300;

/** Neutralize table-breaking characters — catalog rows render as DATA inside
 * a markdown table; a `|` or newline in a description must not restructure
 * the prompt. */
function sanitizeCell(text: string): string {
  return text.replace(/\|/g, '¦').replace(/\s*\n\s*/g, ' ').trim();
}

function extractTextContent(message: ConversationMessage): string | null {
  if (typeof message.content === 'string') return message.content;
  return null;
}

/** Prior user turns (excluding the current message) for follow-up context. */
function recentUserTurns(state: UniversalGraphState): string[] {
  const history = getConv(state.conversations, CONV_KEYS.SESSION_MAIN) as ConversationMessage[];
  const texts: string[] = [];
  for (const m of history) {
    if (m.role !== 'user') continue;
    const text = extractTextContent(m);
    if (text && text.trim().length > 0) texts.push(text.trim());
  }
  // The runner appends the current message as the last user turn — drop it.
  if (texts.length > 0 && texts[texts.length - 1] === state.userMessage) texts.pop();
  return texts.slice(-RECENT_TURNS_MAX).map((t) => sanitizeCell(t).slice(0, RECENT_TURN_CHARS));
}

function buildTurnContext(state: UniversalGraphState, intents: string[], executionTier: ExecutionTierId): UniversalTurnContext {
  const explicit = (state.explicitIntents?.length ?? 0) > 0 || (state.explicitContext?.length ?? 0) > 0;
  return {
    intents,
    context: state.explicitContext ?? [],
    planTurn: state.planRequested === true,
    source: explicit ? 'explicit' : 'infer',
    executionTier,
  };
}

export async function detectNode(state: UniversalGraphState): Promise<Partial<UniversalGraphState>> {
  const resolved = requireActiveCustomJob();
  const catalog = resolved.intents;
  const llm = state.deps?.llm;
  const workflowUpdate = state.deps?.workflowUpdate;

  // 1. Resume without a new user message → keep the restored context, no LLM.
  if (!state.userMessage || state.userMessage.trim().length === 0) {
    const intents = state.restoredIntents?.length ? state.restoredIntents : [GENERAL_INTENT];
    const tier = state.restoredExecutionTier ?? ExecutionTierId.Reflex;
    return { turnContext: buildTurnContext(state, intents, tier) };
  }

  if (workflowUpdate && state._httpJobId) {
    await workflowUpdate.enterNode(
      state._httpJobId, 'detect', 0,
      undefined, llm ? extractLLMInfo(llm) : undefined,
      state.recursionCount, state.recursionLimit,
    );
  }

  try {
    // Explicit `@intent:` mentions fix the labels for this run; the LLM call
    // below then only judges the tier. An empty catalog likewise removes the
    // labeling half — tier judgment is orthogonal to the catalog.
    const explicitIntents = state.explicitIntents?.length ? state.explicitIntents : undefined;
    const needsIntentInference = !explicitIntents && catalog.length > 0;
    const fallbackIntents = explicitIntents ?? [GENERAL_INTENT];

    const promptBuilder = state.deps?.promptBuilder;
    if (!llm || !promptBuilder) {
      console.warn('⚠️ [Universal:Detect] LLM/promptBuilder unavailable — falling back to general/Reflex');
      return { turnContext: buildTurnContext(state, fallbackIntents, ExecutionTierId.Reflex) };
    }

    const result = await promptBuilder.build({
      templates: TEMPLATE_PATHS.universalDetect,
      vars: {
        jobName: resolved.jobName,
        userMessage: state.userMessage,
        recentTurns: recentUserTurns(state),
        needsIntentInference,
        catalogRows: needsIntentInference
          ? catalog.map((i) => ({ id: sanitizeCell(i.id), description: sanitizeCell(i.description) }))
          : [],
      },
    });
    const messages = [{ role: 'user' as const, content: result.user || 'Detect the turn context of the current message.' }];
    const options = {
      system: result.system,
      enableThinking: false,
      temperature: LLM_TEMPERATURE.DETECT,
      signal: getJobAbortSignal(),
    };
    const catalogIds = new Set(catalog.map((i) => i.id));

    const attempt = async () => {
      let raw: string;
      if (llm.invokeWithUsage) {
        const { content, usage } = await llm.invokeWithUsage(messages, options);
        raw = content;
        if (usage) accumulateTokenUsage(state as any, usage, { taskLevel: true, jobLevel: true, modelId: (llm as any).modelName });
      } else {
        raw = await llm.invoke(messages, options);
      }
      return parseDetectResponse(raw, catalogIds, { needsIntents: needsIntentInference });
    };

    let intents = fallbackIntents;
    let tier: ExecutionTierId | undefined;
    try {
      let parsed = await attempt();
      // Retry once when a REQUIRED half is missing (intents when inferring,
      // tier always). Detection failure must never kill the turn — unlike
      // triage (whose single tag is routing-load-bearing and throws), this
      // gate only strengthens the prompt; general/Reflex is a safe floor.
      if ((needsIntentInference && !parsed.intents) || parsed.executionTier === undefined) {
        parsed = await attempt();
      }
      if (parsed.intents) intents = parsed.intents;
      else if (needsIntentInference) console.warn('⚠️ [Universal:Detect] Intent inference failed — falling back to general');
      tier = parsed.executionTier;
    } catch (e) {
      console.warn(`⚠️ [Universal:Detect] Inference failed: ${e instanceof Error ? e.message : String(e)}`);
    }

    const executionTier = tier ?? ExecutionTierId.Reflex;
    if (tier === undefined) {
      console.warn('⚠️ [Universal:Detect] Missing <executionTier> — defaulting to Tier 0 (Reflex)');
    }
    console.log(`🎯 [Universal:Detect] intents=[${intents.join(', ')}] tier=${executionTier}${explicitIntents ? ' (explicit)' : ''}`);

    // Canonical Tag Rendering SSOT — the tier line renders through
    // SpecialTagTransformer (same surface as code decompose's detect emit).
    void emitExecutionTier(executionTier, state.language);

    return { turnContext: buildTurnContext(state, intents, executionTier) };
  } finally {
    if (workflowUpdate && state._httpJobId) {
      await workflowUpdate.exitNode(state._httpJobId, 'detect', 0);
    }
  }
}

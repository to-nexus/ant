/**
 * Universal classify node — multi-label intent inference over the job's own
 * catalog (`ResolvedCustomJob.intents`, code-exterior data).
 *
 * Runs INSIDE the job only: it gates injection inlining and never routes or
 * switches jobs (job identity is fixed by the composer's agent/job chips).
 *
 * Skip ladder (priority order, all decided inside the node):
 *   1. explicit intents (validated at accept) → adopt, zero LLM calls
 *   2. empty catalog → ['general'], zero LLM calls
 *   3. empty userMessage (resume without a new message) → keep restored value
 *   4. infer via one non-streaming LLM call (retry once, then ['general'])
 */

import { GENERAL_INTENT } from '@ant/shared';
import type { UniversalGraphState } from '../../state';
import { CONV_KEYS, getConv, type ConversationMessage } from '../../../../common/graph/conversations';
import { LLM_TEMPERATURE } from '../../../../common/graph/llmConfig';
import { accumulateTokenUsage } from '../../../../common/graph/llmHelpers';
import { getJobAbortSignal } from '../../../../../composition/jobAbort';
import { TEMPLATE_PATHS } from '../../../../../core/prompt/builder/templatePaths';
import { requireActiveCustomJob } from '../../../../../core/customAgents/activeCustomJob';
import { parseIntentsTag } from './parser';

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

export async function classifyNode(state: UniversalGraphState): Promise<Partial<UniversalGraphState>> {
  const resolved = requireActiveCustomJob();
  const catalog = resolved.intents;

  // 1. Explicit intents (mention channel) — apply to THIS run only.
  if (state.explicitIntents && state.explicitIntents.length > 0) {
    console.log(`🎯 [Universal:Classify] Explicit intents adopted: ${state.explicitIntents.join(', ')}`);
    return { activeIntents: state.explicitIntents };
  }

  // 2. No catalog declared → the job runs on the implicit fallback, no LLM.
  if (catalog.length === 0) {
    return { activeIntents: [GENERAL_INTENT] };
  }

  // 3. Resume without a new user message → keep the restored classification.
  if (!state.userMessage || state.userMessage.trim().length === 0) {
    return { activeIntents: state.activeIntents?.length ? state.activeIntents : [GENERAL_INTENT] };
  }

  // 4. Infer.
  const llm = state.deps?.llm;
  const promptBuilder = state.deps?.promptBuilder;
  if (!llm || !promptBuilder) {
    console.warn('⚠️ [Universal:Classify] LLM/promptBuilder unavailable — falling back to general');
    return { activeIntents: [GENERAL_INTENT] };
  }

  const result = await promptBuilder.build({
    templates: TEMPLATE_PATHS.universalClassify,
    vars: {
      jobName: resolved.jobName,
      jobDescription: sanitizeCell(resolved.description),
      userMessage: state.userMessage,
      recentTurns: recentUserTurns(state),
      catalogRows: catalog.map((i) => ({ id: sanitizeCell(i.id), description: sanitizeCell(i.description) })),
    },
  });
  const messages = [{ role: 'user' as const, content: result.user || 'Classify the current message.' }];
  const options = {
    system: result.system,
    enableThinking: false,
    temperature: LLM_TEMPERATURE.DETECT,
    signal: getJobAbortSignal(),
  };
  const catalogIds = new Set(catalog.map((i) => i.id));

  const attempt = async (): Promise<string[] | null> => {
    let raw: string;
    if (llm.invokeWithUsage) {
      const { content, usage } = await llm.invokeWithUsage(messages, options);
      raw = content;
      if (usage) accumulateTokenUsage(state as any, usage, { taskLevel: true, jobLevel: true });
    } else {
      raw = await llm.invoke(messages, options);
    }
    return parseIntentsTag(raw, catalogIds);
  };

  try {
    const first = await attempt();
    if (first) {
      console.log(`🎯 [Universal:Classify] Inferred intents: ${first.join(', ')}`);
      return { activeIntents: first };
    }
    const retry = await attempt();
    if (retry) {
      console.log(`🎯 [Universal:Classify] Inferred intents (retry): ${retry.join(', ')}`);
      return { activeIntents: retry };
    }
  } catch (e) {
    console.warn(`⚠️ [Universal:Classify] Inference failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  // Classification failure must never kill the turn — unlike triage (whose
  // single tag is routing-load-bearing and therefore throws), this gate only
  // strengthens the prompt; general is a safe floor.
  console.warn('⚠️ [Universal:Classify] Falling back to general');
  return { activeIntents: [GENERAL_INTENT] };
}

/**
 * assistant_turn distillation (P2 — e2-humming-spindle Context Lens)
 *
 * Write-once, at job end (the same seam as breadcrumb emission): records the
 * turn's user-facing final assistant prose (`finalText`) and a structured
 * `TurnDigest` into feature.jsonl. This is the durable channel that lets
 * later jobs resolve referents ("옵션 B로 하자" → "두 번째 걸로") without
 * ever live-sourcing chat.jsonl (Chat Clear invariant).
 *
 * Digest sources, in trust order:
 *  1. choice_resolved lines — user decisions already structured on disk;
 *     ingested deterministically (no LLM, highest trust).
 *  2. small LLM call (Tier 2+ callers opt in via `useLlmDigest`) for
 *     free-prose decisions/constraints/outcome. Timeout + fallback: the
 *     line is never blocked on the LLM.
 *  3. template fallback — choice decisions + outcome hint (breadcrumb
 *     summary) + finalText head.
 *
 * Failure policy mirrors breadcrumb: log + swallow. A distillation miss
 * must never abort the owning learn node.
 */

import type { SessionPort } from '../ports/session';
import type { LLMClient } from '../ports/llm';
import type { PromptPort } from '../ports/prompt';
import { LLM_TEMPERATURE } from '../ports/llmSampling';
import type {
  ChatLine,
  FeatureAssistantTurnLine,
  LogJobType,
  TurnDigest,
} from '@ant/shared';
import { assistantProseOf, capTail } from './chatTailBuilder';

/** finalText cap — ~800 tokens at 2.8 chars/token. */
export const ASSISTANT_TURN_FINAL_TEXT_CAP = 2240;
/** LLM digest call budget. */
export const TURN_DIGEST_TIMEOUT_MS = 8000;
export const TURN_DIGEST_MAX_OUTPUT_TOKENS = 512;
/** Outcome fallback length (finalText head) when no hint is provided. */
const OUTCOME_HEAD_CAP = 200;

export interface DistillAssistantTurnInput {
  session: SessionPort | undefined;
  jobId?: string;
  turnId?: string;
  jobType: LogJobType;
  /** The user directive that opened this turn (digest context). */
  directive?: string;
  /**
   * Raw executionTier id from state. The LLM-digest decision (Tier 2+ only)
   * lives HERE, not in phase nodes — D11: phases don't compare tier
   * literals. Absent/0/1 → template-only digest.
   */
  executionTierId?: number;
  llm?: LLMClient;
  promptPort?: PromptPort;
  /** ask / inline-ask — fast-demoting conversational record. */
  ephemeral?: boolean;
  /** Outcome for the template fallback (e.g. breadcrumb summary). */
  outcomeHint?: string;
  /**
   * Direct final-prose source (ask path: the graph's own `response` — chat
   * lines may not be flushed yet at distill time). Skips the chat harvest.
   */
  finalTextOverride?: string;
}

/**
 * Distill and append the turn's assistant_turn line. Never throws.
 * Returns the appended line (for tests/logging) or undefined when skipped.
 */
export async function distillAssistantTurn(
  input: DistillAssistantTurnInput,
): Promise<FeatureAssistantTurnLine | undefined> {
  const { session, jobId, turnId } = input;
  if (!session) {
    console.warn('⚠️  [AssistantTurn] skipped: session port unavailable');
    return undefined;
  }
  if (!jobId || !turnId) {
    console.warn(
      `⚠️  [AssistantTurn] skipped: missing context (jobId=${jobId ?? 'undefined'}, turnId=${turnId ?? 'undefined'})`,
    );
    return undefined;
  }

  try {
    let finalText: string;
    let choiceDecisions: string[];
    if (typeof input.finalTextOverride === 'string') {
      finalText = capTail(input.finalTextOverride.trim(), ASSISTANT_TURN_FINAL_TEXT_CAP);
      choiceDecisions = [];
    } else {
      const lines = await session.loadChatByTurnIds([turnId]);
      const proseParts: string[] = [];
      for (const line of lines) {
        const prose = assistantProseOf(line);
        if (prose) proseParts.push(prose);
      }
      finalText = capTail(proseParts.join('\n').trim(), ASSISTANT_TURN_FINAL_TEXT_CAP);
      choiceDecisions = extractChoiceDecisions(lines);
    }

    if (!finalText && choiceDecisions.length === 0) {
      console.log('📝 [AssistantTurn] skipped: no user-facing prose or decisions this turn');
      return undefined;
    }

    const digest = await buildDigest({ ...input, finalText, choiceDecisions });

    const line: FeatureAssistantTurnLine = {
      type: 'assistant_turn',
      ts: new Date().toISOString(),
      jobId,
      turnId,
      jobType: input.jobType,
      finalText,
      ...(digest ? { digest } : {}),
      ...(input.ephemeral ? { ephemeral: true as const } : {}),
    };

    await session.appendAssistantTurn(line);
    console.log(
      `📝 [AssistantTurn] appended (finalText=${finalText.length} chars, decisions=${digest?.decisions.length ?? 0}, constraints=${digest?.constraints.length ?? 0}${input.ephemeral ? ', ephemeral' : ''})`,
    );
    return line;
  } catch (err) {
    console.warn(`⚠️  [AssistantTurn] distillation failed (jobId=${jobId}, turnId=${turnId}):`, err);
    return undefined;
  }
}

/**
 * Deterministic ingestion of resolved choice cards: the user's structured
 * decisions are already on disk — no LLM extraction needed (and none
 * trusted more). Dismissals are recorded too ("user declined X" is a
 * decision).
 */
export function extractChoiceDecisions(lines: ChatLine[]): string[] {
  const presentedById = new Map<string, { prompt?: string; cardType?: string }>();
  const decisions: string[] = [];

  for (const line of lines) {
    if (line.type === 'choice_presented') {
      presentedById.set(line.cardId, { prompt: line.prompt, cardType: line.cardType });
    } else if (line.type === 'choice_resolved') {
      const presented = presentedById.get(line.cardId);
      const subject = presented?.prompt || presented?.cardType || 'choice';
      const answerStr = line.answer ? compactAnswer(line.answer) : '';
      const decision = answerStr
        ? `${subject} → ${line.choiceSelected}: ${answerStr}`
        : `${subject} → ${line.choiceSelected}`;
      decisions.push(decision);
    }
  }
  return decisions;
}

function compactAnswer(answer: Record<string, unknown>): string {
  try {
    const json = JSON.stringify(answer);
    return json.length > 300 ? `${json.slice(0, 300)}…` : json;
  } catch {
    return '';
  }
}

interface BuildDigestInput extends DistillAssistantTurnInput {
  finalText: string;
  choiceDecisions: string[];
}

async function buildDigest(input: BuildDigestInput): Promise<TurnDigest | undefined> {
  const fallback = templateDigest(input);

  const useLlmDigest = (input.executionTierId ?? 0) >= 2;
  if (!useLlmDigest || !input.llm || !input.promptPort) return fallback;

  try {
    const systemPrompt = await input.promptPort.render('infra/turn-digest/system', {
      directive: input.directive || '(no directive)',
      finalText: input.finalText || '(no final prose)',
      choiceDecisions: input.choiceDecisions,
    });
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: 'Produce the turn digest JSON.' },
    ];
    const raw = await withTimeout(
      input.llm.invoke(messages, {
        maxTokens: TURN_DIGEST_MAX_OUTPUT_TOKENS,
        enableThinking: false,
        temperature: LLM_TEMPERATURE.SUMMARIZE,
      }),
      TURN_DIGEST_TIMEOUT_MS,
    );
    const parsed = parseDigestJson(raw);
    if (!parsed) {
      console.warn('⚠️  [AssistantTurn] digest LLM returned unparseable output, using template digest');
      return fallback;
    }
    // choice_resolved decisions are the highest-trust source — always keep
    // them, prepended, deduped against the LLM's own phrasing.
    const merged = new Set<string>([...input.choiceDecisions, ...parsed.decisions]);
    return {
      decisions: [...merged],
      constraints: parsed.constraints,
      outcome: parsed.outcome || fallback?.outcome || '',
      ...(parsed.openQuestions?.length ? { openQuestions: parsed.openQuestions } : {}),
    };
  } catch (err) {
    console.warn('⚠️  [AssistantTurn] digest LLM call failed, using template digest:', err);
    return fallback;
  }
}

function templateDigest(input: BuildDigestInput): TurnDigest | undefined {
  const outcome =
    input.outcomeHint?.trim() ||
    (input.finalText ? input.finalText.slice(0, OUTCOME_HEAD_CAP) : '');
  if (!outcome && input.choiceDecisions.length === 0) return undefined;
  return {
    decisions: input.choiceDecisions,
    constraints: [],
    outcome,
  };
}

function parseDigestJson(raw: string | undefined): TurnDigest | undefined {
  if (!raw) return undefined;
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return undefined;
  try {
    const obj = JSON.parse(match[0]);
    const arr = (v: unknown): string[] =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0) : [];
    return {
      decisions: arr(obj.decisions),
      constraints: arr(obj.constraints),
      outcome: typeof obj.outcome === 'string' ? obj.outcome : '',
      ...(arr(obj.openQuestions).length ? { openQuestions: arr(obj.openQuestions) } : {}),
    };
  } catch {
    return undefined;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = setTimeout(() => reject(new Error(`turn digest timeout after ${ms}ms`)), ms);
    promise.then(
      (v) => { clearTimeout(id); resolve(v); },
      (e) => { clearTimeout(id); reject(e); },
    );
  });
}

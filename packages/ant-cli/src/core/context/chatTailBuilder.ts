/**
 * Chat Tail Builder (P1 — e2-humming-spindle Context Lens)
 *
 * Assembles a "rich tail" of the most recent user↔assistant exchanges from
 * chat.jsonl for injection into conversational-rim consumers (ask/inline-ask
 * agent, Tier 0/1 direct). These consumers previously received ZERO prior
 * assistant utterances — "옵션 B로 하자" → the next turn only saw "두 번째
 * 걸로 해줘" with the referent lost.
 *
 * This is the schema-change-free P1 path: it reads chat.jsonl on demand and
 * never writes anything. P2 replaces the source with durable
 * `assistant_turn` lines in feature.jsonl (Chat Clear invariant: contexts
 * must not live-source chat.jsonl long-term — this builder is the documented
 * transitional fallback, and Chat Clear collapsing chat.jsonl lines is an
 * accepted P1 limitation that P2 removes).
 *
 * Assistant text per turn is harvested from two user-facing surfaces:
 *  - `assistant_message` lines, EXCLUDING kinds that are not final prose
 *    (`system_notice` / `rendered_payload` / `thinking_chunk`). Absent kind
 *    means 'legacy' free text (schema contract) and is included.
 *  - `chat_status` lines with `statusType === 'task_response'` — completed
 *    task summaries carry the de-facto final answer in current data.
 *
 * The per-turn concatenation keeps the TAIL (final response is the most
 * informative and chronologically last), capped in chars.
 */

import type { SessionPort } from '../ports/session';
import type { ChatLine } from '@ant/shared';

export interface ChatTailExchange {
  turnId: string;
  jobType?: string;
  ts: string;
  userText: string;
  /** Tail-capped concatenation of the turn's user-facing assistant prose. */
  assistantText?: string;
}

export interface ChatTail {
  exchanges: ChatTailExchange[];
}

export interface BuildChatTailOptions {
  /** Number of most-recent exchanges to keep. Default 6 (rich profile K). */
  k?: number;
  /**
   * Per-exchange assistant text cap in chars. Default 1680
   * (~600 tokens at 2.8 chars/token — rich profile band-1 cap).
   */
  assistantCharCap?: number;
  /** Per-exchange user text cap in chars (defensive; user turns are short). */
  userCharCap?: number;
  /**
   * Turn to exclude — the current turn is already on disk when consumers
   * run, and its directive is injected separately as the question.
   */
  excludeTurnId?: string;
}

const DEFAULT_K = 6;
const DEFAULT_ASSISTANT_CHAR_CAP = 1680;
const DEFAULT_USER_CHAR_CAP = 2000;

/** assistant_message kinds that are NOT user-facing final prose. */
const EXCLUDED_ASSISTANT_KINDS = new Set([
  'system_notice',
  'rendered_payload',
  'thinking_chunk',
]);

/**
 * Extract the user-facing assistant prose from one chat line, or undefined.
 * Shared by the tail builder (per-turn grouping below) and the job-end
 * assistant_turn distiller (`assistantTurn.ts`), so both surfaces agree on
 * what counts as "what the assistant said".
 */
export function assistantProseOf(line: ChatLine): string | undefined {
  if (line.type === 'assistant_message') {
    const kind = (line as { kind?: string }).kind;
    if (kind && EXCLUDED_ASSISTANT_KINDS.has(kind)) return undefined;
    const text = (line as { text?: string }).text;
    return text || undefined;
  }
  if (line.type === 'chat_status') {
    const statusLine = line as { statusType?: string; metadata?: { content?: unknown } };
    if (statusLine.statusType !== 'task_response') return undefined;
    const content = statusLine.metadata?.content;
    return typeof content === 'string' && content ? content : undefined;
  }
  return undefined;
}

export async function buildChatTail(
  session: SessionPort | undefined,
  options: BuildChatTailOptions = {},
): Promise<ChatTail | undefined> {
  if (!session) return undefined;

  const k = options.k ?? DEFAULT_K;
  const assistantCap = options.assistantCharCap ?? DEFAULT_ASSISTANT_CHAR_CAP;
  const userCap = options.userCharCap ?? DEFAULT_USER_CHAR_CAP;

  let lines: ChatLine[];
  try {
    lines = await session.loadAllChat();
  } catch (err) {
    console.warn('⚠️  [ChatTail] loadAllChat failed:', err);
    return undefined;
  }
  if (!lines.length) return { exchanges: [] };

  // Group by turnId preserving append (chronological) order.
  const byTurn = new Map<
    string,
    { ts: string; jobType?: string; userText?: string; assistantParts: string[] }
  >();
  for (const line of lines) {
    if (!line.turnId || line.turnId === options.excludeTurnId) continue;
    let entry = byTurn.get(line.turnId);
    if (!entry) {
      entry = { ts: line.ts, jobType: line.jobType, assistantParts: [] };
      byTurn.set(line.turnId, entry);
    }

    if (line.type === 'user_turn') {
      entry.userText = (line as { text?: string }).text || '';
      entry.ts = line.ts;
    } else {
      const prose = assistantProseOf(line);
      if (prose) entry.assistantParts.push(prose);
    }
  }

  const exchanges: ChatTailExchange[] = [];
  for (const [turnId, entry] of byTurn) {
    if (!entry.userText) continue; // exchanges anchor on a user turn
    const joined = entry.assistantParts.join('\n').trim();
    exchanges.push({
      turnId,
      jobType: entry.jobType,
      ts: entry.ts,
      userText: capHead(entry.userText, userCap),
      assistantText: joined ? capTail(joined, assistantCap) : undefined,
    });
  }

  return { exchanges: exchanges.slice(-k) };
}

/** Keep the head of a user directive (the ask usually leads). */
function capHead(text: string, cap: number): string {
  return text.length <= cap ? text : `${text.slice(0, cap)}\n… [truncated]`;
}

/** Keep the tail of assistant prose (the final answer usually trails). */
export function capTail(text: string, cap: number): string {
  return text.length <= cap ? text : `… [earlier output truncated]\n${text.slice(-cap)}`;
}

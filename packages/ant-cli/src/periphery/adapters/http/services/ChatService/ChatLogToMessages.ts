/**
 * ChatLogToMessages — build `ChatMessage[]` from chat.jsonl.
 *
 * Session redesign §16.2 (revised by "chat SSOT fragmentation purge"):
 * chat.jsonl is the durable SSOT for chat rendering. Every non-structural
 * card is a single `chat_status` line; replay rebuilds the card by
 * feeding `(statusType, metadata)` back through
 * `generateChatStatusContent` — the same function the live path uses.
 *
 * Stateful card pairs (`choice_presented` + `choice_resolved`) remain
 * distinct line kinds because their rendering depends on whether the
 * user has answered yet.
 *
 * Shape contract:
 * - One `role='user'` ChatMessage per distinct turnId (from the
 *   `user_turn` line).
 * - One `role='assistant'` ChatMessage per distinct turnId (from all
 *   non-user events in that turn, in chronological order).
 * - Empty / untagged events (no turnId) go to a synthetic `__untagged__`
 *   bucket that still renders (useful for orphaned history).
 */

import type {
  ChatLine,
  ChatStatusLine,
  ChatStatusType,
  ChatChoicePresentedLine,
  ChatChoiceResolvedLine,
} from '@ant/shared';
import type { ChatMessage, MessageContent } from './types';
import { generateChatStatusContent } from '../../../../../core/llm-response/generateStatusContent';

export interface ChatLogInput {
  chatLines: ChatLine[];
}

/**
 * Convert chat log lines to a ChatMessage[] view.
 *
 * Messages are sorted by each turn's earliest event timestamp; the very
 * first line of a turn is typically the `user_turn` copy, so the "user
 * bubble then assistant response" ordering is preserved.
 */
export function buildChatMessagesFromChatLog(input: ChatLogInput): ChatMessage[] {
  const { chatLines } = input;
  if (!chatLines || chatLines.length === 0) return [];

  // Precompute resolution map (cardId → resolved line). Later
  // `choice_resolved` wins if multiple exist for the same cardId.
  const resolvedById = new Map<string, ChatChoiceResolvedLine>();
  for (const line of chatLines) {
    if (line.collapsed) continue;
    if (line.type === 'choice_resolved') {
      resolvedById.set(line.cardId, line);
    }
  }

  // Group by turnId.
  type Bucket = {
    turnId: string;
    firstTs: string;
    jobId: string;
    userLine?: ChatLine;
    events: ChatLine[];
  };
  const buckets = new Map<string, Bucket>();
  for (const line of chatLines) {
    if (line.collapsed) continue;
    // choice_resolved lines are consumed via the map above; they do not
    // render on their own.
    if (line.type === 'choice_resolved') continue;
    const key = line.turnId || '__untagged__';
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        turnId: key,
        firstTs: line.ts,
        jobId: line.jobId,
        events: [],
      };
      buckets.set(key, bucket);
    }
    if (line.ts < bucket.firstTs) bucket.firstTs = line.ts;
    if (line.type === 'user_turn') {
      bucket.userLine = line;
    } else {
      bucket.events.push(line);
    }
  }

  // Sort turns by earliest ts, events within a turn by ts.
  const ordered = [...buckets.values()].sort((a, b) => cmp(a.firstTs, b.firstTs));
  for (const b of ordered) {
    b.events.sort((a, b) => cmp(a.ts, b.ts));
  }

  const out: ChatMessage[] = [];
  for (const bucket of ordered) {
    const userMsg = toUserMessage(bucket);
    if (userMsg) out.push(userMsg);
    const assistantMsg = toAssistantMessage(bucket, resolvedById);
    if (assistantMsg) out.push(assistantMsg);
  }
  return out;
}

function toUserMessage(bucket: {
  turnId: string;
  firstTs: string;
  jobId: string;
  userLine?: ChatLine;
}): ChatMessage | null {
  if (!bucket.userLine || bucket.userLine.type !== 'user_turn') return null;
  const line = bucket.userLine;
  return {
    id: `user-${bucket.turnId}`,
    role: 'user',
    timestamp: line.ts,
    jobId: bucket.jobId,
    contents: [
      {
        type: 'text',
        content: line.text,
      },
    ],
    ...(line.actionMetadata && Object.keys(line.actionMetadata).length > 0 && { actionMetadata: line.actionMetadata }),
  };
}

function toAssistantMessage(
  bucket: {
    turnId: string;
    firstTs: string;
    jobId: string;
    events: ChatLine[];
  },
  resolvedById: Map<string, ChatChoiceResolvedLine>,
): ChatMessage | null {
  const contents: MessageContent[] = [];
  let lastThinkingIdx: number | null = null;
  let assistantId = `assistant-${bucket.turnId}`;

  for (const ev of bucket.events) {
    switch (ev.type) {
      case 'assistant_thinking': {
        // Adjacent thinking lines merge into a single content block so the
        // UI collapses the reasoning the same way live streaming would.
        if (lastThinkingIdx !== null) {
          const prev = contents[lastThinkingIdx];
          if (prev && prev.type === 'thinking') {
            prev.content = `${prev.content}${prev.content && ev.text ? '\n' : ''}${ev.text}`;
            break;
          }
        }
        contents.push({
          type: 'thinking',
          content: ev.text,
          metadata: { timestamp: ev.ts },
        });
        lastThinkingIdx = contents.length - 1;
        break;
      }
      case 'chat_status': {
        lastThinkingIdx = null;
        contents.push(renderChatStatus(ev));
        break;
      }
      case 'assistant_message': {
        lastThinkingIdx = null;
        if (ev.text && ev.text.trim()) {
          contents.push({
            type: 'text',
            content: ev.text,
            metadata: { timestamp: ev.ts },
          });
        }
        break;
      }
      case 'choice_presented': {
        lastThinkingIdx = null;
        // Keep the first choice card's cardId as the ChatMessage id so
        // frontend interactions (dismiss-choice) continue to work against
        // the same handle the server originally emitted.
        if (contents.length === 0) assistantId = ev.cardId;
        contents.push(renderChoiceCard(ev, resolvedById.get(ev.cardId)));
        break;
      }
      default:
        break;
    }
  }

  if (contents.length === 0) return null;

  return {
    id: assistantId,
    role: 'assistant',
    timestamp: bucket.firstTs,
    jobId: bucket.jobId,
    contents,
  };
}

/**
 * Rebuild a `MessageContent` from a persisted `chat_status` line using
 * the exact same function the live path used (`generateChatStatusContent`)
 * so the replayed card body is byte-identical to the broadcast copy.
 *
 * The persisted `metadata` is passed through unchanged — WorkingCard /
 * FileCard / TerminalCard / choice card components read the same keys
 * they read in live mode (`filePath`, `diffBefore`/`diffAfter`, `command`
 * + `exitCode`, `pattern`, etc.).
 */
function renderChatStatus(ev: ChatStatusLine): MessageContent {
  const statusType = ev.statusType as ChatStatusType;
  const metadata = { ...(ev.metadata ?? {}), timestamp: ev.ts } as Record<string, unknown>;
  const content = generateChatStatusContent(statusType, metadata as Record<string, any>);
  return {
    type: statusType as MessageContent['type'],
    content,
    metadata: metadata as MessageContent['metadata'],
  };
}

/**
 * Render a `choice_presented` line (possibly resolved by a later
 * `choice_resolved` line) as a `ChatMessage` content block. Three
 * contentType branches match the UI choice-card components:
 * - `cardType === 'triage_choice'` → `MessageContent.type = 'triage_choice'`
 * - `cardType === 'cancelled'`     → `MessageContent.type = 'cancelled'`
 * - everything else                → `MessageContent.type = 'choice_card'` with
 *                                      `metadata.cardType` carrying the subtype
 */
function renderChoiceCard(
  presented: ChatChoicePresentedLine,
  resolved?: ChatChoiceResolvedLine,
): MessageContent {
  const payload = presented.payload ?? {};
  let type: MessageContent['type'];
  const metadata: Record<string, unknown> = { timestamp: presented.ts };

  if (presented.cardType === 'triage_choice') {
    type = 'triage_choice';
  } else if (presented.cardType === 'cancelled') {
    type = 'cancelled';
  } else {
    type = 'choice_card';
    metadata.cardType = presented.cardType;
  }

  // Common payload fields — copy over whatever the UI expects. The payload
  // shape is cardType-specific; we just forward it verbatim.
  for (const [key, value] of Object.entries(payload)) {
    if (value !== undefined) metadata[key] = value;
  }

  if (resolved) {
    metadata.choiceSelected = resolved.choiceSelected;
    metadata.resolvedLabel = resolved.resolvedLabel;
    if (resolved.answer) {
      for (const [key, value] of Object.entries(resolved.answer)) {
        if (value !== undefined) metadata[key] = value;
      }
    }
    // For cancelled cards the UI also watches `resolved: true` to hide the
    // Resume button. Set it whenever we have any resolution.
    metadata.resolved = true;
  }

  return {
    type,
    content: presented.prompt ?? '',
    metadata: metadata as MessageContent['metadata'],
  };
}

function cmp(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

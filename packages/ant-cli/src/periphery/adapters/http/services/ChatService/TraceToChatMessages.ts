/**
 * TraceToChatMessages — build `ChatMessage[]` from trace.jsonl.
 *
 * Session redesign §16.2: trace.jsonl is the durable SSOT for chat
 * rendering. This adapter rebuilds the legacy `ChatMessage[]` shape the
 * UI expects so `ChatHistory` / `MessageItem` keep working unchanged.
 * breadcrumbs / user_turn_meta are consumed elsewhere (Timeline tab,
 * tier badge) — this adapter only reads trace lines.
 *
 * Shape contract:
 * - One `role='user'` ChatMessage per distinct turnId (populated from the
 *   trace `user_turn` line).
 * - One `role='assistant'` ChatMessage per distinct turnId (populated from
 *   all non-user events in that turn, in chronological order).
 * - Empty / untagged events (no turnId) go to a synthetic `__untagged__`
 *   bucket that still renders (useful for legacy features).
 *
 * Choice cards (triage_choice / cancelled / eval_save / clarifying /
 * spec_complete) are materialised from `choice_presented` lines, then
 * overlaid with `choice_resolved` lines to restore the `choiceSelected` /
 * `resolvedLabel` metadata that the UI relies on.
 */

import type {
  TraceLine,
  TraceChoicePresentedLine,
  TraceChoiceResolvedLine,
} from '@ant/shared';
import type { ChatMessage, MessageContent } from './types';
import { dispatchToolCallToContent } from '../../../../../core/llm-response/toolDispatch';

export interface TraceInput {
  traceLines: TraceLine[];
}

/**
 * Convert trace lines to a ChatMessage[] view.
 *
 * Messages are sorted by each turn's earliest event timestamp; the very
 * first line of a turn is typically the `user_turn` copy, so the "user
 * bubble then assistant response" ordering is preserved.
 */
export function buildChatMessagesFromTrace(input: TraceInput): ChatMessage[] {
  const { traceLines } = input;
  if (!traceLines || traceLines.length === 0) return [];

  // ─── Precompute resolution map (cardId → resolved line) ─────────────
  // Later `choice_resolved` wins if multiple exist for the same cardId.
  const resolvedById = new Map<string, TraceChoiceResolvedLine>();
  for (const line of traceLines) {
    if (line.collapsed) continue;
    if (line.type === 'choice_resolved') {
      resolvedById.set(line.cardId, line);
    }
  }

  // ─── Group by turnId ────────────────────────────────────────────────
  type Bucket = {
    turnId: string;
    firstTs: string;
    jobId: string;
    userLine?: TraceLine;
    events: TraceLine[];
  };
  const buckets = new Map<string, Bucket>();
  for (const line of traceLines) {
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

  // ─── Sort turns by earliest ts, events within a turn by ts ─────────
  const ordered = [...buckets.values()].sort((a, b) => cmp(a.firstTs, b.firstTs));
  for (const b of ordered) {
    b.events.sort((a, b) => cmp(a.ts, b.ts));
  }

  // ─── Emit ChatMessage[] per bucket ─────────────────────────────────
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
  userLine?: TraceLine;
}): ChatMessage | null {
  if (!bucket.userLine || bucket.userLine.type !== 'user_turn') return null;
  return {
    id: `user-${bucket.turnId}`,
    role: 'user',
    timestamp: bucket.userLine.ts,
    jobId: bucket.jobId,
    contents: [
      {
        type: 'text',
        content: bucket.userLine.text,
      },
    ],
  };
}

function toAssistantMessage(
  bucket: {
    turnId: string;
    firstTs: string;
    jobId: string;
    events: TraceLine[];
  },
  resolvedById: Map<string, TraceChoiceResolvedLine>,
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
      case 'tool_call': {
        lastThinkingIdx = null;
        // SSOT: core/llm-response/toolDispatch.ts decides which tools
        // materialise a card vs. defer to a companion trace line
        // (file_write owns file ops; run_command owns TerminalCard).
        const content = dispatchToolCallToContent(ev.tool, ev.args, ev.error, ev.ts);
        if (content) contents.push(content);
        break;
      }
      case 'file_write': {
        lastThinkingIdx = null;
        const isFailed = typeof ev.error === 'string' && ev.error.length > 0;
        const type: MessageContent['type'] =
          ev.operation === 'create'
            ? (isFailed ? 'file_create_failed' : 'file_create')
            : ev.operation === 'delete'
              ? (isFailed ? 'file_delete_failed' : 'file_delete')
              : (isFailed ? 'file_edit_failed' : 'file_edit');
        contents.push({
          type,
          // file_create / file_delete surface `content`, file_edit surfaces
          // a diff via metadata; FileCard reads both shapes.
          content: ev.operation === 'update' ? '' : (ev.content ?? ''),
          metadata: {
            filePath: ev.path,
            diffBefore: ev.diffBefore,
            diffAfter: ev.diffAfter,
            reason: isFailed ? ev.error : undefined,
            timestamp: ev.ts,
          },
        });
        break;
      }
      case 'run_command': {
        lastThinkingIdx = null;
        contents.push({
          type: 'command',
          content: ev.stdout ?? '',
          metadata: {
            command: ev.cmd,
            exitCode: ev.exitCode,
            timestamp: ev.ts,
          },
        });
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
      case 'job_status':
        // Skipped — the chat view already shows phase changes via workflow
        // stream. Emitting a content row here would duplicate that.
        break;
      case 'choice_presented': {
        lastThinkingIdx = null;
        // Keep the first choice card's cardId as the ChatMessage id so
        // frontend interactions (dismiss-choice) continue to work against
        // the same handle the server originally emitted.
        if (contents.length === 0) assistantId = ev.cardId;
        const content = renderChoiceCard(ev, resolvedById.get(ev.cardId));
        contents.push(content);
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
 * Render a `choice_presented` line (possibly resolved by a later
 * `choice_resolved` line) as a legacy `ChatMessage` content block. Three
 * contentType branches match the UI choice-card components:
 * - `cardType === 'triage_choice'` → `MessageContent.type = 'triage_choice'`
 * - `cardType === 'cancelled'`     → `MessageContent.type = 'cancelled'`
 * - everything else                → `MessageContent.type = 'choice_card'` with
 *                                      `metadata.cardType` carrying the subtype
 */
function renderChoiceCard(
  presented: TraceChoicePresentedLine,
  resolved?: TraceChoiceResolvedLine,
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

  // Overlay the resolution if present.
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

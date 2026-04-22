/**
 * TraceToChatMessages — build `ChatMessage[]` from chat.jsonl (legacy name:
 * trace.jsonl).
 *
 * Session redesign §16.2 (revised by "chat SSOT fragmentation purge"):
 * chat.jsonl is the durable SSOT for chat rendering. The canonical on-disk
 * shape is the `chat_status` line; every non-structural chat card replays
 * by feeding `(statusType, metadata)` back through `generateStatusContent`
 * — the same function the live path uses. Legacy line kinds
 * (`tool_call` / `file_write` / `run_command` / `job_status`) are still
 * handled here for feature folders created before the SSOT collapse; they
 * will be removed in a follow-up commit once no recent data contains them.
 *
 * breadcrumbs / user_turn_meta are consumed elsewhere (Timeline tab, tier
 * badge) — this adapter only reads chat log lines.
 *
 * Shape contract:
 * - One `role='user'` ChatMessage per distinct turnId (populated from the
 *   `user_turn` line).
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
  ChatStatusLine,
  ChatStatusType,
} from '@ant/shared';
import type { ChatMessage, MessageContent } from './types';
import { dispatchToolCallToContent } from '../../../../../core/llm-response/toolDispatch';
import { generateChatStatusContent } from '../../../../../core/llm-response/generateStatusContent';

export interface TraceInput {
  traceLines: TraceLine[];
}

/**
 * Lookup from a tool name (persisted in legacy `tool_call` lines) to the
 * `chat_status.statusType` its handler emits today. Used to dedup when
 * both representations coexist in the same turn bucket.
 */
const TOOL_TO_DEDICATED_STATUS_TYPE: Record<string, ChatStatusType> = {
  read_file: 'read',
  list_files: 'listed_files',
  search_code: 'searched_code',
  search_reference_code: 'searched_reference',
};

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

  // Chat SSOT: `showChatStatus` also emits `choice_presented` during the
  // migration so choice_resolved pairing keeps working. When BOTH a
  // chat_status('triage_choice'|'choice_card') AND a matching
  // choice_presented line are present for the same card, prefer the
  // choice_presented rendering path (it already overlays resolution).
  // Detect this by collecting cardIds seen in choice_presented lines.
  const choicePresentedCardIds = new Set<string>();
  // Dedicated-status tools (`read_file` / `list_files` / `search_code` /
  // `search_reference_code`) now emit a `chat_status` line via
  // `showChatStatus('read'|'listed_files'|…)` in their handler. The
  // companion `tool_call` line still exists in the log (LLMEventHandler
  // appends it tool-agnostically) but its rendering would duplicate the
  // chat_status card. Collect the statusTypes we have seen in
  // `chat_status` so the `tool_call` case below can skip them.
  const chatStatusTypesSeen = new Set<string>();
  for (const ev of bucket.events) {
    if (ev.type === 'choice_presented') choicePresentedCardIds.add(ev.cardId);
    if (ev.type === 'chat_status') chatStatusTypesSeen.add(ev.statusType);
  }

  for (const ev of bucket.events) {
    switch (ev.type) {
      case 'chat_status': {
        lastThinkingIdx = null;
        // Skip choice-card chat_status when a companion choice_presented
        // line carries the authoritative payload (with resolvedLabel /
        // choiceSelected overlay) for the same cardId.
        const cardId = (ev.metadata && typeof ev.metadata.cardId === 'string')
          ? ev.metadata.cardId
          : undefined;
        if (cardId && choicePresentedCardIds.has(cardId)) break;
        const status = renderChatStatus(ev);
        if (status) contents.push(status);
        break;
      }
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
        // Post-SSOT dedup: dedicated-status tools now have an authoritative
        // `chat_status` line (`read` / `listed_files` / `searched_code` /
        // `searched_reference`). When that line is present in this turn's
        // bucket, rendering the `tool_call` too would produce a duplicate
        // card — skip it.
        const dedupStatusType = TOOL_TO_DEDICATED_STATUS_TYPE[ev.tool];
        if (dedupStatusType && chatStatusTypesSeen.has(dedupStatusType)) break;
        // SSOT: core/llm-response/toolDispatch.ts decides which tools
        // materialise a card vs. defer to a companion chat log line
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
function renderChatStatus(ev: ChatStatusLine): MessageContent | null {
  const statusType = ev.statusType as ChatStatusType;
  const metadata = { ...(ev.metadata ?? {}), timestamp: ev.ts } as Record<string, unknown>;
  const content = generateChatStatusContent(statusType, metadata as Record<string, any>);
  return {
    type: statusType as MessageContent['type'],
    content,
    metadata: metadata as MessageContent['metadata'],
  };
}

function cmp(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * Chat selectors — the FE projector for the chat-SSOT model.
 *
 * Phase 10 of the chat-SSOT unification (master plan
 * `.cursor/plans/chat-ssot-unification_be4c8599.plan.md`) replaced the
 * legacy `chatMessages: ChatMessage[]` SSE-mutation slice with a pair
 * of disjoint inputs:
 *
 *   - `chatEvents: ChatLine[]` — finalized chat.jsonl lines.
 *   - `streamingBuffers: Record<bufferKey, StreamingBuffer>` — in-flight
 *     text / thinking / per-card output owned by the BE Redis
 *     TURN_BUFFER. Buffer key format: `${turnId}:${workerScope}`.
 *
 * `selectTurns(state)` is the single derivation point that turns the
 * pair into the rendering shape consumed by ChatHistory / TurnItem.
 *
 * Folding rules (mirrors the chat-SSOT spec):
 *  - `turnId` groups every event into a `Turn`.
 *  - Within a turn, `workerScope` (defaulted to `_main_`) splits into
 *    sub-sections. The BE stamps `worker-N#task-K` when a parallel
 *    TaskWorker is inside a task, so each task gets its own section
 *    even when a long-lived worker handles multiple tasks across
 *    barrier cohorts.
 *  - Sections sort by first-event timestamp (ascending) with `_main_`
 *    pinned to the first position — restores chronology when later
 *    cohorts are queued behind earlier ones.
 *  - `chat_status` lines fold by `cardId` (last-write-wins) so a card's
 *    progressive states (e.g. `command_running` → `command_streaming`
 *    → `command`) collapse into one item.
 *  - `choice_presented` + `choice_resolved` pair on `cardId` and render
 *    as a single resolved/unresolved choice item. Cancelled cards
 *    receive a synthetic `_cancelled_:{cardId}` workerScope on the BE
 *    appender (`ChatService.appendChoicePresentedCancelled`) so each
 *    cancellation lands in its own section and the chronological sort
 *    places it at its actual ts — i.e. below worker output that ran
 *    before the user clicked Stop, and above worker output that
 *    accumulates after Resume.
 *  - `streamingBuffers` overlay produces `activeText` / `activeThinking`
 *    / `pendingCards` so live deltas surface above the durable folded
 *    cards without mutating the disk SSOT.
 *
 * Phase 11 finalised this projector: the legacy `selectChatMessages`
 * adapter has been removed; `ChatHistory` / `TurnItem` consume `Turn[]`
 * directly.
 */

import type {
  ChatLine,
  ChatStatusLine,
  ChatThinkingLine,
  ChatAssistantMessageLine,
  ChatUserTurnLine,
  ChatChoicePresentedLine,
  ChatChoiceResolvedLine,
  PendingCardSnapshot,
  LogJobType,
} from '@ant/shared';
import type { FileStats } from '@/domain/models/chat';

// ═══════════════════════════════════════════════════════════════════════
// Public shapes
// ═══════════════════════════════════════════════════════════════════════

/**
 * Per-turn streaming buffer. Mirror of the BE `TurnBufferSnapshot`,
 * scoped by `${turnId}:${workerScope}`. Only the live portion of the
 * stream is here — finalized text becomes a `chat_status`
 * ('text' / 'thinking' / 'task_response' / …) line.
 */
export interface StreamingBuffer {
  turnId: string;
  workerScope: string;
  text?: string;
  thinking?: string;
  pendingCards?: Record<string, PendingCardSnapshot>;
}

export type BufferKey = string; // `${turnId}:${workerScope}`

export const MAIN_WORKER_SCOPE = '_main_' as const;

export function makeBufferKey(turnId: string, workerScope?: string | null): BufferKey {
  return `${turnId}:${workerScope || MAIN_WORKER_SCOPE}`;
}

// ── Turn shape ──────────────────────────────────────────────────────

export type TurnItem =
  | { kind: 'thinking'; line: ChatThinkingLine }
  | {
      kind: 'status';
      line: ChatStatusLine;
      pending?: PendingCardSnapshot;
    }
  | { kind: 'assistant_message'; line: ChatAssistantMessageLine }
  | {
      kind: 'choice';
      presented: ChatChoicePresentedLine;
      resolved?: ChatChoiceResolvedLine;
    };

export interface TurnSection {
  workerScope: string;
  items: TurnItem[];
  /** Active in-flight thinking text (overlay above any finalized thinking). */
  activeThinking?: string;
  /** Active in-flight assistant text (rendered before any final assistant_message). */
  activeText?: string;
  /** Pending cards keyed by cardId — overlays for cards that have not yet finalized. */
  pendingCards?: Record<string, PendingCardSnapshot>;
}

export interface Turn {
  turnId: string;
  jobId: string;
  jobType: LogJobType;
  ts: string; // first event ts
  user?: ChatUserTurnLine;
  /** Ordered list of (workerScope, items). `_main_` is always first when present. */
  sections: TurnSection[];
}

// ═══════════════════════════════════════════════════════════════════════
// Reference-stability cache
// ═══════════════════════════════════════════════════════════════════════
//
// `selectTurns` is invoked on every store update. Returning a fresh
// `Turn[]` each call would force every chat consumer to re-render on
// unrelated slice updates. Cache the projection keyed by the
// `(chatEvents, streamingBuffers)` references — the slice creates new
// references when either changes (immutable update), so identity is
// the change signal. While both refs stay stable we return the same
// `Turn[]` reference and React bails out.
// ═══════════════════════════════════════════════════════════════════════

interface TurnsCacheEntry {
  events: ChatLine[];
  buffers: Record<BufferKey, StreamingBuffer>;
  turns: Turn[];
}

let turnsCache: TurnsCacheEntry | null = null;

const EMPTY_TURNS: Turn[] = Object.freeze([]) as unknown as Turn[];

export interface ChatProjectorState {
  chatEvents: ChatLine[];
  streamingBuffers: Record<BufferKey, StreamingBuffer>;
}

// ═══════════════════════════════════════════════════════════════════════
// selectTurns — the projector
// ═══════════════════════════════════════════════════════════════════════

export function selectTurns(state: ChatProjectorState): Turn[] {
  const { chatEvents, streamingBuffers } = state;
  if (!chatEvents || chatEvents.length === 0) {
    if (!streamingBuffers || Object.keys(streamingBuffers).length === 0) {
      return EMPTY_TURNS;
    }
  }

  if (
    turnsCache &&
    turnsCache.events === chatEvents &&
    turnsCache.buffers === streamingBuffers
  ) {
    return turnsCache.turns;
  }

  const turns = projectTurns(chatEvents ?? [], streamingBuffers ?? {});
  turnsCache = {
    events: chatEvents ?? [],
    buffers: streamingBuffers ?? {},
    turns,
  };
  return turns;
}

function projectTurns(
  events: ChatLine[],
  buffers: Record<BufferKey, StreamingBuffer>,
): Turn[] {
  // Filter collapsed lines — they exist on disk but are excluded from UI.
  const live = events.filter((l) => !l.collapsed);

  // 1. Group events by turnId in their original order so we can rebuild
  //    the conversation chronology turn-by-turn.
  const turnOrder: string[] = [];
  const byTurn = new Map<string, ChatLine[]>();
  for (const line of live) {
    const turnId = line.turnId;
    if (!byTurn.has(turnId)) {
      byTurn.set(turnId, []);
      turnOrder.push(turnId);
    }
    byTurn.get(turnId)!.push(line);
  }

  // 2. Project each turn.
  const turns: Turn[] = [];
  for (const turnId of turnOrder) {
    const lines = byTurn.get(turnId)!;
    turns.push(projectSingleTurn(turnId, lines, buffers));
  }

  // 3. Surface streaming buffers that have no events yet (orphan
  //    pre-flight chunks). Real chat-SSOT writes a user_turn first so
  //    this branch is rare, but it keeps the projector total.
  for (const [key, buf] of Object.entries(buffers)) {
    if (byTurn.has(buf.turnId)) continue;
    const turn: Turn = {
      turnId: buf.turnId,
      jobId: '',
      jobType: 'code',
      ts: new Date().toISOString(),
      sections: [
        {
          workerScope: buf.workerScope || MAIN_WORKER_SCOPE,
          items: [],
          activeText: buf.text,
          activeThinking: buf.thinking,
          pendingCards: buf.pendingCards,
        },
      ],
    };
    turns.push(turn);
    void key;
  }

  return turns;
}

function projectSingleTurn(
  turnId: string,
  lines: ChatLine[],
  buffers: Record<BufferKey, StreamingBuffer>,
): Turn {
  let user: ChatUserTurnLine | undefined;
  const firstLine = lines[0];
  const ts = firstLine?.ts ?? new Date().toISOString();
  let jobId = '';
  let jobType: LogJobType = (firstLine?.jobType as LogJobType) ?? 'code';

  // workerScope → ordered ChatLine[] within the turn.
  const sectionOrder: string[] = [];
  const linesByScope = new Map<string, ChatLine[]>();

  // First-event timestamp per scope — used for chronological section
  // ordering below. `_main_` is hard-pinned to first via the sort
  // comparator (orchestration-narrative policy), so its ts entry is
  // unused for ordering; we therefore record only the actual first
  // `_main_` event ts for parity with other scopes.
  const firstTsByScope = new Map<string, string>();

  for (const line of lines) {
    if (line.type === 'user_turn') {
      user = line;
      jobId ||= line.jobId;
      jobType = (line.jobType as LogJobType) ?? jobType;
      // user_turn is rendered above sections, not inside them.
      continue;
    }
    const scope = line.workerScope || MAIN_WORKER_SCOPE;
    if (!linesByScope.has(scope)) {
      linesByScope.set(scope, []);
      sectionOrder.push(scope);
    }
    linesByScope.get(scope)!.push(line);
    if (!firstTsByScope.has(scope)) firstTsByScope.set(scope, line.ts);
    jobId ||= line.jobId;
  }

  // Section ordering — chronological by first-event timestamp.
  //
  // `_main_` is pinned to the FIRST position regardless of ts so the
  // turn-level orchestration narrative (assistant_message, etc.) reads
  // as the introduction to the parallel work that follows. Every other
  // section sorts by ascending `firstTsByScope`, with workerScope as a
  // tiebreaker for determinism. This restores chronology across
  // long-lived TaskWorkers that handle barrier cohorts in sequence
  // (e.g. UI cohort → test-code cohort): a worker that picks up a
  // cohort-2 task gets a fresh `worker-N#task-K` scope whose first ts
  // sorts AFTER cohort-1 sections, so cohort-2 messages render below.
  sectionOrder.sort((a, b) => {
    if (a === b) return 0;
    if (a === MAIN_WORKER_SCOPE) return -1;
    if (b === MAIN_WORKER_SCOPE) return 1;
    const ta = firstTsByScope.get(a) ?? '';
    const tb = firstTsByScope.get(b) ?? '';
    if (ta !== tb) return ta < tb ? -1 : 1;
    return a.localeCompare(b);
  });

  const sections: TurnSection[] = sectionOrder.map((scope) =>
    foldSection(scope, linesByScope.get(scope) ?? [], buffers, turnId),
  );

  // Sections that exist only as a streaming buffer (no events for that
  // worker scope yet) — rare but keeps live workers visible immediately.
  for (const [, buf] of Object.entries(buffers)) {
    if (buf.turnId !== turnId) continue;
    const scope = buf.workerScope || MAIN_WORKER_SCOPE;
    if (sections.some((s) => s.workerScope === scope)) continue;
    sections.push({
      workerScope: scope,
      items: [],
      activeText: buf.text,
      activeThinking: buf.thinking,
      pendingCards: buf.pendingCards,
    });
  }

  return {
    turnId,
    jobId,
    jobType,
    ts,
    user,
    sections,
  };
}

function foldSection(
  workerScope: string,
  lines: ChatLine[],
  buffers: Record<BufferKey, StreamingBuffer>,
  turnId: string,
): TurnSection {
  // Two passes:
  //   pass 1 — choice + status fold by cardId (last-write-wins for
  //            status; presented/resolved pairing for choice).
  //   pass 2 — emit items in line order, replacing each cardId's first
  //            occurrence with the folded view.

  // cardId → last status line.
  const statusByCard = new Map<string, ChatStatusLine>();
  // cardId → presented + resolved.
  const choiceByCard = new Map<
    string,
    { presented?: ChatChoicePresentedLine; resolved?: ChatChoiceResolvedLine }
  >();

  for (const line of lines) {
    if (line.type === 'chat_status') {
      // Last-write-wins on cardId.
      const prev = statusByCard.get(line.cardId);
      if (!prev || line.ts >= prev.ts) statusByCard.set(line.cardId, line);
    } else if (line.type === 'choice_presented') {
      const e = choiceByCard.get(line.cardId) ?? {};
      e.presented = line;
      choiceByCard.set(line.cardId, e);
    } else if (line.type === 'choice_resolved') {
      const e = choiceByCard.get(line.cardId) ?? {};
      e.resolved = line;
      choiceByCard.set(line.cardId, e);
    }
  }

  // Track which cardIds have already been emitted so the second
  // occurrence (e.g. a later command_streaming chunk for the same
  // card_running line) doesn't duplicate the rendered card.
  const emittedCards = new Set<string>();
  const items: TurnItem[] = [];

  for (const line of lines) {
    if (line.type === 'chat_status') {
      if (emittedCards.has(line.cardId)) continue;
      emittedCards.add(line.cardId);
      const folded = statusByCard.get(line.cardId) ?? line;
      const bufKey = makeBufferKey(turnId, workerScope);
      const pending = buffers[bufKey]?.pendingCards?.[line.cardId];
      items.push({ kind: 'status', line: folded, pending });
    } else if (line.type === 'assistant_thinking') {
      items.push({ kind: 'thinking', line });
    } else if (line.type === 'assistant_message') {
      items.push({ kind: 'assistant_message', line });
    } else if (line.type === 'choice_presented') {
      if (emittedCards.has(line.cardId)) continue;
      emittedCards.add(line.cardId);
      const pair = choiceByCard.get(line.cardId);
      if (pair?.presented) {
        items.push({
          kind: 'choice',
          presented: pair.presented,
          resolved: pair.resolved,
        });
      }
    } else if (line.type === 'choice_resolved') {
      // The resolved line is rendered alongside its presented sibling
      // when present. Standalone resolved (no matching presented in
      // this section) emits a synthetic choice item so the action's
      // outcome remains visible.
      if (emittedCards.has(line.cardId)) continue;
      const pair = choiceByCard.get(line.cardId);
      if (pair?.presented) continue; // Will be emitted with presented.
      emittedCards.add(line.cardId);
      items.push({
        kind: 'choice',
        presented: {
          type: 'choice_presented',
          ts: line.ts,
          jobId: line.jobId,
          turnId: line.turnId,
          jobType: line.jobType,
          cardId: line.cardId,
          cardType: 'unknown',
        } as ChatChoicePresentedLine,
        resolved: line,
      });
    }
    // user_turn already extracted above.
  }

  // Streaming overlay for this section.
  const bufKey = makeBufferKey(turnId, workerScope);
  const buf = buffers[bufKey];
  return {
    workerScope,
    items,
    activeText: buf?.text,
    activeThinking: buf?.thinking,
    pendingCards: buf?.pendingCards,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// selectActiveStreamingFor + selectFileStats — small helpers used by
// the chat header and FileStats badge.
// ═══════════════════════════════════════════════════════════════════════

export function selectActiveStreamingFor(
  state: ChatProjectorState,
  turnId: string,
  workerScope: string = MAIN_WORKER_SCOPE,
): StreamingBuffer | undefined {
  return state.streamingBuffers?.[makeBufferKey(turnId, workerScope)];
}

/**
 * Aggregate file-operation stats from the chat-SSOT event stream.
 *
 * Dedup rule (matches the legacy ChatPanel behaviour): the latest
 * terminal operation per file path wins — i.e. if the same path was
 * created and later edited, the file appears once with operation
 * 'edit'. This keeps the FileChangeSummary badge counting unique files,
 * not raw operation events.
 *
 * Cached on the `chatEvents` reference so successive calls during a
 * single render pass return the same `FileStats` object — required for
 * zustand `useStore(selectFileStats)` consumers, otherwise every store
 * update would mint a fresh object and force ChatPanel + ChatInput to
 * re-render even when no file event landed.
 */
let fileStatsCache: { events: ChatLine[]; stats: FileStats } | null = null;

const EMPTY_FILE_STATS: FileStats = Object.freeze({
  filesCreated: 0,
  filesEdited: 0,
  filesDeleted: 0,
  totalFiles: 0,
  files: Object.freeze([]) as unknown as FileStats['files'],
}) as unknown as FileStats;

export function selectFileStats(state: ChatProjectorState): FileStats {
  const events = state.chatEvents ?? [];
  if (fileStatsCache && fileStatsCache.events === events) {
    return fileStatsCache.stats;
  }
  if (events.length === 0) {
    fileStatsCache = { events, stats: EMPTY_FILE_STATS };
    return EMPTY_FILE_STATS;
  }

  const operationByPath = new Map<string, 'create' | 'edit' | 'delete'>();
  const orderedPaths: string[] = [];

  for (const line of events) {
    if (line.collapsed) continue;
    if (line.type !== 'chat_status') continue;
    const md = line.metadata as Record<string, any> | undefined;
    const path = md?.filePath as string | undefined;
    if (!path) continue;
    let op: 'create' | 'edit' | 'delete' | null = null;
    switch (line.statusType) {
      case 'file_create':
        op = 'create';
        break;
      case 'file_edit':
        op = 'edit';
        break;
      case 'file_delete':
        op = 'delete';
        break;
    }
    if (!op) continue;
    if (!operationByPath.has(path)) orderedPaths.push(path);
    operationByPath.set(path, op); // last-write-wins
  }

  if (operationByPath.size === 0) {
    fileStatsCache = { events, stats: EMPTY_FILE_STATS };
    return EMPTY_FILE_STATS;
  }

  const files: Array<{ path: string; operation: 'create' | 'edit' | 'delete' }> = [];
  let filesCreated = 0;
  let filesEdited = 0;
  let filesDeleted = 0;
  for (const path of orderedPaths) {
    const op = operationByPath.get(path)!;
    files.push({ path, operation: op });
    if (op === 'create') filesCreated++;
    else if (op === 'edit') filesEdited++;
    else filesDeleted++;
  }

  const stats: FileStats = {
    filesCreated,
    filesEdited,
    filesDeleted,
    totalFiles: operationByPath.size,
    files,
  };
  fileStatsCache = { events, stats };
  return stats;
}

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
  KanbanData,
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
// Incremental projection cache (Phase 11.1 — chat-render-jank-fix)
// ═══════════════════════════════════════════════════════════════════════
//
// `selectTurns` runs on every store update; in long sessions
// `chatEvents` can hold hundreds of lines and a single SSE delta would
// otherwise re-fold the entire history. The cache below splits the
// projection into per-turn slots so an `appendChatEvent` of a single
// line only re-projects the affected turn, and `applyStreamingDelta`
// only re-folds one section. Every other turn keeps its previous
// `Turn` reference, which lets `React.memo` on `TurnItem` bail out for
// the rest of the viewport.
//
// Reference-stability invariants:
//   • `selectTurns` returns the same `Turn[]` ref iff every per-turn
//     slot reused its prior `Turn` and the turn order is unchanged.
//   • A `Turn` reference is reused iff its per-turn `events` array AND
//     its per-turn `buffersByScope` map both still hold the same refs
//     as the previous projection.
//   • A per-turn `events` array is reused when no new event landed in
//     that turn; a per-turn `buffersByScope` map is reused when none of
//     its (scope → `StreamingBuffer`) entries changed identity.
//
// Cache invalidation is monotonic: if any invariant breaks for a turn,
// only that turn re-projects. Full rebuild only happens when the
// `chatEvents` array is no longer a prefix of the previous one (i.e.
// `replaceChatEvents` / `clearChatEvents`).
// ═══════════════════════════════════════════════════════════════════════

interface TurnsCacheEntry {
  events: ChatLine[];
  buffers: Record<BufferKey, StreamingBuffer>;
  turns: Turn[];
  /** Per-turn live (non-collapsed) events. Reference-stable iff that turn's events are unchanged. */
  eventsByTurn: Map<string, ChatLine[]>;
  /** Per-turn streaming buffers. Reference-stable iff that turn's buffer set is unchanged. */
  buffersByTurn: Map<string, Map<string, StreamingBuffer>>;
  /** Events-only turn order (does NOT include orphan-buffer-only turnIds). */
  eventsTurnOrder: string[];
  /** Combined turn order (events first, then orphan-buffer-only) — matches `turns`. */
  turnOrder: string[];
  /** Per-turn cached projection — reused when both `eventsArr` and `buffersByScope` refs match. */
  turnByTurnId: Map<
    string,
    {
      eventsArr: ChatLine[];
      buffersByScope: Map<string, StreamingBuffer>;
      turn: Turn;
    }
  >;
}

let turnsCache: TurnsCacheEntry | null = null;

const EMPTY_TURNS: Turn[] = Object.freeze([]) as unknown as Turn[];
const EMPTY_LINES: ChatLine[] = Object.freeze([]) as unknown as ChatLine[];
const EMPTY_BUFFER_MAP: Map<string, StreamingBuffer> = new Map();
const LOG_JOB_TYPES = new Set<LogJobType>([
  'code',
  'design',
  'learn',
  'ask',
  'plan',
  'inline-ask',
  'visual',
]);

function parseLogJobType(value: unknown): LogJobType | undefined {
  if (typeof value !== 'string') return undefined;
  return LOG_JOB_TYPES.has(value as LogJobType) ? (value as LogJobType) : undefined;
}

/**
 * Test-only: drop the module-level cache so a test can simulate a
 * cold projector. Production code must never call this.
 */
export function __resetTurnsCacheForTests(): void {
  turnsCache = null;
}

export interface ChatProjectorState {
  chatEvents: ChatLine[];
  streamingBuffers: Record<BufferKey, StreamingBuffer>;
}

// ═══════════════════════════════════════════════════════════════════════
// selectTurns — the projector
// ═══════════════════════════════════════════════════════════════════════

export function selectTurns(state: ChatProjectorState): Turn[] {
  const events = state.chatEvents ?? EMPTY_LINES;
  const buffers = state.streamingBuffers ?? {};

  if (events.length === 0 && Object.keys(buffers).length === 0) {
    return EMPTY_TURNS;
  }

  if (turnsCache && turnsCache.events === events && turnsCache.buffers === buffers) {
    return turnsCache.turns;
  }

  const prev = turnsCache;
  const { eventsByTurn, eventsTurnOrder } = buildEventsByTurn(events, prev);
  const buffersByTurn = buildBuffersByTurn(buffers, prev);

  // turnOrder = events-defined turns first, then orphan-buffer-only turns
  // (in iteration order). Once an orphan turn appears in events its
  // position is taken from `eventsTurnOrder`, so renaming an orphan turn
  // to a real turn doesn't shuffle the list.
  const turnOrder: string[] = [...eventsTurnOrder];
  const seen = new Set(turnOrder);
  for (const turnId of buffersByTurn.keys()) {
    if (!seen.has(turnId)) {
      turnOrder.push(turnId);
      seen.add(turnId);
    }
  }

  const turns: Turn[] = [];
  const turnByTurnId = new Map<
    string,
    { eventsArr: ChatLine[]; buffersByScope: Map<string, StreamingBuffer>; turn: Turn }
  >();
  let allReused = !!prev && turnOrder.length === prev.turnOrder.length;

  for (let i = 0; i < turnOrder.length; i++) {
    const turnId = turnOrder[i];
    const eventsArr = eventsByTurn.get(turnId) ?? EMPTY_LINES;
    const buffersByScope = buffersByTurn.get(turnId) ?? EMPTY_BUFFER_MAP;
    const cached = prev?.turnByTurnId.get(turnId);
    if (
      cached &&
      cached.eventsArr === eventsArr &&
      cached.buffersByScope === buffersByScope
    ) {
      turns.push(cached.turn);
      turnByTurnId.set(turnId, cached);
    } else {
      const turn = projectSingleTurn(turnId, eventsArr, buffersByScope);
      const entry = { eventsArr, buffersByScope, turn };
      turns.push(turn);
      turnByTurnId.set(turnId, entry);
      allReused = false;
    }
    if (allReused && prev!.turnOrder[i] !== turnId) {
      allReused = false;
    }
  }

  // When every turn slot was reused and the turn order is unchanged,
  // keep the previous `Turn[]` reference so React.memo bails out at the
  // root level too. This happens, for instance, when `replaceChatEvents`
  // is fed a snapshot whose entries reference-equal the prior cache.
  const finalTurns =
    allReused && prev && turns.length === prev.turns.length
      ? prev.turns
      : turnOrder.length === 0
        ? EMPTY_TURNS
        : turns;

  turnsCache = {
    events,
    buffers,
    turns: finalTurns,
    eventsByTurn,
    buffersByTurn,
    eventsTurnOrder,
    turnOrder,
    turnByTurnId,
  };
  return finalTurns;
}

/**
 * Group `events` into per-turn arrays, dropping `collapsed` lines.
 *
 * Fast path: when `events` extends `prev.events` as a strict prefix
 * (the common SSE-append case), we clone only the per-turn arrays for
 * turns that received new lines, leaving the rest reference-stable.
 * Same-content / different-array case (rare) also reuses prev — only a
 * different content prefix forces full re-grouping.
 */
function buildEventsByTurn(
  events: ChatLine[],
  prev: TurnsCacheEntry | null,
): { eventsByTurn: Map<string, ChatLine[]>; eventsTurnOrder: string[] } {
  if (prev && prev.events === events) {
    return {
      eventsByTurn: prev.eventsByTurn,
      eventsTurnOrder: prev.eventsTurnOrder,
    };
  }

  if (prev && events.length >= prev.events.length) {
    let isPrefix = true;
    for (let i = 0; i < prev.events.length; i++) {
      if (events[i] !== prev.events[i]) {
        isPrefix = false;
        break;
      }
    }
    if (isPrefix) {
      if (events.length === prev.events.length) {
        // New array reference, identical contents — reuse per-turn arrays
        // verbatim so downstream Turn caches stay warm.
        return {
          eventsByTurn: prev.eventsByTurn,
          eventsTurnOrder: prev.eventsTurnOrder,
        };
      }
      const eventsByTurn = new Map(prev.eventsByTurn);
      const eventsTurnOrder = [...prev.eventsTurnOrder];
      const dirty = new Set<string>();
      for (let i = prev.events.length; i < events.length; i++) {
        const line = events[i];
        if (line.collapsed) continue;
        const turnId = line.turnId;
        if (!eventsByTurn.has(turnId)) {
          eventsByTurn.set(turnId, []);
          eventsTurnOrder.push(turnId);
        } else if (!dirty.has(turnId)) {
          // First mutation for this turn: clone its array so prev keeps
          // its reference-stable view.
          eventsByTurn.set(turnId, [...eventsByTurn.get(turnId)!]);
          dirty.add(turnId);
        }
        eventsByTurn.get(turnId)!.push(line);
      }
      return { eventsByTurn, eventsTurnOrder };
    }
  }

  // Full re-group.
  const eventsByTurn = new Map<string, ChatLine[]>();
  const eventsTurnOrder: string[] = [];
  for (const line of events) {
    if (line.collapsed) continue;
    const turnId = line.turnId;
    if (!eventsByTurn.has(turnId)) {
      eventsByTurn.set(turnId, []);
      eventsTurnOrder.push(turnId);
    }
    eventsByTurn.get(turnId)!.push(line);
  }
  return { eventsByTurn, eventsTurnOrder };
}

/**
 * Group `buffers` into per-turn `Map<scope, StreamingBuffer>` slots.
 *
 * Reuses the prev slot's reference when no entry inside it changed
 * identity, so an `applyStreamingDelta` that touches one buffer key
 * only invalidates that turn's slot.
 */
function buildBuffersByTurn(
  buffers: Record<BufferKey, StreamingBuffer>,
  prev: TurnsCacheEntry | null,
): Map<string, Map<string, StreamingBuffer>> {
  if (prev && prev.buffers === buffers) {
    return prev.buffersByTurn;
  }

  const out = new Map<string, Map<string, StreamingBuffer>>();
  for (const buf of Object.values(buffers)) {
    const turnId = buf.turnId;
    let m = out.get(turnId);
    if (!m) {
      m = new Map();
      out.set(turnId, m);
    }
    m.set(buf.workerScope || MAIN_WORKER_SCOPE, buf);
  }

  if (prev) {
    for (const [turnId, m] of out) {
      const prevM = prev.buffersByTurn.get(turnId);
      if (prevM && mapsRefEqual(prevM, m)) {
        out.set(turnId, prevM);
      }
    }
  }
  return out;
}

function mapsRefEqual<K, V>(a: Map<K, V>, b: Map<K, V>): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const [k, v] of a) {
    if (b.get(k) !== v) return false;
  }
  return true;
}

function projectSingleTurn(
  turnId: string,
  lines: ChatLine[],
  buffersByScope: Map<string, StreamingBuffer>,
): Turn {
  let user: ChatUserTurnLine | undefined;
  const firstLine = lines[0];
  const ts = firstLine?.ts ?? new Date().toISOString();
  let jobId = '';
  let jobType: LogJobType =
    parseLogJobType(firstLine?.jobType) ??
    resolveJobTypeFromBuffers(buffersByScope) ??
    'code';

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
      jobType = parseLogJobType(line.jobType) ?? jobType;
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
    jobType = parseLogJobType(line.jobType) ?? jobType;
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
    foldSection(scope, linesByScope.get(scope) ?? [], buffersByScope),
  );

  // Sections that exist only as a streaming buffer (no events for that
  // worker scope yet) — rare but keeps live workers visible immediately.
  for (const [scope, buf] of buffersByScope) {
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

function resolveJobTypeFromBuffers(
  buffersByScope: Map<string, StreamingBuffer>,
): LogJobType | undefined {
  for (const buffer of buffersByScope.values()) {
    const pendingCards = buffer.pendingCards ?? {};
    for (const pending of Object.values(pendingCards)) {
      const fromMetadata = parseLogJobType(
        (pending.metadata as Record<string, unknown> | undefined)?.jobType,
      );
      if (fromMetadata) return fromMetadata;
    }
  }
  return undefined;
}

function foldSection(
  workerScope: string,
  lines: ChatLine[],
  buffersByScope: Map<string, StreamingBuffer>,
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
  const buf = buffersByScope.get(workerScope);

  for (const line of lines) {
    if (line.type === 'chat_status') {
      if (emittedCards.has(line.cardId)) continue;
      emittedCards.add(line.cardId);
      const folded = statusByCard.get(line.cardId) ?? line;
      const pending = buf?.pendingCards?.[line.cardId];
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

// ═══════════════════════════════════════════════════════════════════════
// Unresolved choice card detection — autoscroll veto signal
// ═══════════════════════════════════════════════════════════════════════
//
// When a choice card is presented (task fail/interrupt etc.) and not yet
// resolved by the user, autoscroll in ChatHistory must NOT push the card
// out of the viewport. Parallel-task events arriving in the same feed
// otherwise displace the card and the user misses it. See ChatHistory.tsx
// for how this flag gates every autoscroll trigger.
//
// INVARIANT — regression-prone: only UNRESOLVED cards are counted. Once
// the user resolves a card (resume / dismiss / etc.), it must stop
// influencing autoscroll so subsequent content scrolls past it naturally.
// Keep the `!item.resolved` condition tight.

export interface PendingChoiceInfo {
  has: boolean;
  /** Index of the turn containing the latest unresolved choice card; null if has=false. */
  turnIndex: number | null;
}

export function getPendingChoice(turns: Turn[]): PendingChoiceInfo {
  for (let i = turns.length - 1; i >= 0; i--) {
    for (const section of turns[i].sections) {
      for (const item of section.items) {
        if (item.kind === 'choice' && !item.resolved) {
          return { has: true, turnIndex: i };
        }
      }
    }
  }
  return { has: false, turnIndex: null };
}

/**
 * Resume-affordance safety net (grim-padding-grove RCA).
 *
 * The cancelled/resume card is normally a durable `choice_presented` line in
 * chat.jsonl, appended by the first pause's `cleanupJobState`. A cross-pod
 * finalize race (StaleJobRecovery pausing a job whose worker child is still
 * alive) can leave a job persisted as `paused + canResume:true` WITHOUT that
 * line ever landing — so the chat log has no card and the user has no way to
 * resume on reconnect, even though the polled kanban already carries the
 * resumable interruption.
 *
 * When the kanban carries a resumable, undismissed interruption and NO durable
 * cancelled card already exists for that job, synthesize a `choice_presented`
 * line so it renders through the existing `CancelledVariant` + resume path.
 * Returns null (no synthesis) when the job is running, the interruption was
 * dismissed/non-resumable, or a durable cancelled card already exists — so the
 * synthetic card never double-renders the real one.
 */
export function selectResumeFallbackCard(
  turns: Turn[],
  kanban: KanbanData | null | undefined,
  isRunning: boolean,
  dismissedInterruptTimestamp: string | null | undefined,
): ChatChoicePresentedLine | null {
  const interruption = kanban?.interruption;
  const jobId = kanban?.jobId;
  if (!jobId || isRunning) return null;
  if (!interruption || interruption.canResume !== true) return null;
  if (interruption.timestamp === dismissedInterruptTimestamp) return null;

  // Dedup: a durable cancelled card for this job already renders via `turns`.
  for (const turn of turns) {
    for (const section of turn.sections) {
      for (const item of section.items) {
        if (
          item.kind === 'choice' &&
          item.presented.cardType === 'cancelled' &&
          item.presented.jobId === jobId
        ) {
          return null;
        }
      }
    }
  }

  const jobType = (kanban as { jobType?: LogJobType }).jobType ?? 'code';
  return {
    type: 'choice_presented',
    ts: interruption.timestamp,
    jobId,
    turnId: `resume-fallback:${jobId}`,
    jobType,
    cardId: `resume-fallback:${jobId}:${interruption.timestamp}`,
    cardType: 'cancelled',
    payload: {
      jobId,
      reason: interruption.reason,
      originalType: jobType,
    },
  };
}

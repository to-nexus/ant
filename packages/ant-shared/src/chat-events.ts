/**
 * Chat SSE Event Types — cross-boundary contract for the unified chat stream.
 *
 * Every chat event is either:
 *  - A **finalized** `ChatLine` appended to `chat.jsonl` (durable SSOT).
 *  - A **streaming** delta / snapshot of in-flight text·thinking·card
 *    output owned by Redis TURN_BUFFER.
 *
 * All finalized chat state lives in chat.jsonl; all in-flight (partial)
 * state lives in Redis TURN_BUFFER. No overlap. Clients always render from
 * `(ChatLine[], TurnBufferSnapshotMap)` via a shared projector.
 *
 * Every event carries `producedAt` / `serverTs` so clients can drop
 * out-of-order deltas that predate the last snapshot.
 */

import type {
  ChatLine,
  ChatStatusType,
} from './session-log';

// ═══════════════════════════════════════════════════════════════════════
// Redis TURN_BUFFER shape (mirrored on the client)
// ═══════════════════════════════════════════════════════════════════════

/**
 * In-flight card tracked under `TURN_BUFFER[turnId][workerScope].pendingCards[cardId]`.
 *
 * The card's identity (`cardId`, `statusType`) + current metadata snapshot
 * is carried here so reconnecting clients can render the right component
 * with the right streaming output, even when no chat_status line has yet
 * been emitted.
 */
export interface PendingCardSnapshot {
  cardId: string;
  statusType: ChatStatusType;
  metadata: Record<string, unknown>;
  streamedOutput?: string;
}

/**
 * Per-turn streaming buffer. Keyed by worker scope (`_main_` for the
 * main graph, `worker-<N>` for parallel sub-workers).
 */
export interface TurnBufferSnapshot {
  turnId: string;
  workerScope: string;
  text?: string;
  thinking?: string;
  pendingCards?: Record<string, PendingCardSnapshot>;
}

/**
 * Snapshot map used by `chat_initial_state` and `sync_request` replies.
 * Key format: `${turnId}:${workerScope}`.
 */
export type TurnBufferSnapshotMap = Record<string, TurnBufferSnapshot>;

// ═══════════════════════════════════════════════════════════════════════
// Server → Client events
// ═══════════════════════════════════════════════════════════════════════

/** Initial snapshot sent on SSE open/reconnect. */
export interface ChatInitialStateEvent {
  type: 'chat_initial_state';
  events: ChatLine[];
  turnBuffers: TurnBufferSnapshotMap;
  /** Monotonic server clock — clients update `lastChatSnapshotTs` from this. */
  serverTs: string;
  projectId: string;
  featureName: string;
}

/** A single ChatLine was appended to chat.jsonl. */
export interface ChatEventAppendedEvent {
  type: 'chat_event_appended';
  event: ChatLine;
  producedAt: string;
  projectId: string;
  featureName: string;
}

/** In-flight chunk for text / thinking / per-card output. */
export interface ChatStreamingDeltaEvent {
  type: 'streaming_delta';
  turnId: string;
  workerScope?: string;
  kind: 'text' | 'thinking' | 'card_output';
  /** Required when `kind === 'card_output'`. */
  cardId?: string;
  chunk: string;
  producedAt: string;
  projectId: string;
  featureName: string;
}

/**
 * Full snapshot of a single (turnId, workerScope) buffer. Emitted in
 * response to `sync_request` on SSE reconnect so mid-stream clients can
 * recover partial state without losing chunks.
 */
export interface ChatStreamingBufferSnapshotEvent {
  type: 'streaming_buffer_snapshot';
  turnId: string;
  workerScope?: string;
  text?: string;
  thinking?: string;
  pendingCards?: Record<string, PendingCardSnapshot>;
  producedAt: string;
  projectId: string;
  featureName: string;
}

/** Chat log cleared (Chat Clear or Hard Reset). */
export interface ChatEventsClearedEvent {
  type: 'events_cleared';
  scope: 'chat' | 'full';
  serverTs: string;
  projectId: string;
  featureName: string;
}

/**
 * Union of chat SSE events. Non-chat events (inline_ask_complete,
 * job_status, kanban, ...) remain on their own contracts.
 */
export type ChatSseEvent =
  | ChatInitialStateEvent
  | ChatEventAppendedEvent
  | ChatStreamingDeltaEvent
  | ChatStreamingBufferSnapshotEvent
  | ChatEventsClearedEvent;

/**
 * Discriminator values — handy for chatSseHandler switch statements.
 */
export const CHAT_SSE_EVENT_TYPES = {
  INITIAL_STATE: 'chat_initial_state',
  EVENT_APPENDED: 'chat_event_appended',
  STREAMING_DELTA: 'streaming_delta',
  STREAMING_BUFFER_SNAPSHOT: 'streaming_buffer_snapshot',
  EVENTS_CLEARED: 'events_cleared',
} as const;

// ═══════════════════════════════════════════════════════════════════════
// Refine-impact alert — F3 cross-document synchronisation
// ═══════════════════════════════════════════════════════════════════════

/**
 * One affected design task surfaced to the operator after a rev-plan
 * completion. The chat-status card uses this shape inside
 * `metadata.affected[]`. The FE renders one line per item beneath the
 * summary headline.
 */
export interface RefineImpactAffected {
  taskId: string;
  taskName: string;
  targetFile?: string;
  /** PRD/GDD identifiers / `§X` markers this task cited that were rewritten. */
  matchedSections: string[];
}

/**
 * Metadata shape for `chat_status` lines whose `statusType === 'refine_impact'`.
 *
 * Emitted by the rev-plan completion hook
 * (`packages/ant-cli/src/core/refine/refineImpactAlert.ts`) once
 * `extractDependencies` + `extractPlanDiff` + `detectAffectedTasks`
 * have produced a result.
 *
 * Keep the shape stable — `generateChatStatusContent('refine_impact', ...)`
 * in `chat-status.ts` and the FE alert renderer both rely on it.
 */
export interface RefineImpactMetadata {
  /** Canonical plan output that was rewritten by `rev-plan`. */
  updatedDoc: 'prd.md' | 'gdd.md';
  /** PRD/GDD section markers / stable identifiers extracted from the diff. */
  updatedSections: string[];
  /** Cascade layers that contributed (LLM tag, git diff, or user directive). */
  diffSources: Array<'llm-tag' | 'git-diff' | 'directive'>;
  /** Design tasks whose citations intersect `updatedSections`. */
  affected: RefineImpactAffected[];
  /**
   * Design tasks excluded from `affected` because their authoring
   * checkpoint did not have the plan doc as `role='ref'`. The FE
   * meta banner uses this list so users see which tasks the
   * synchronisation can NOT speak about.
   */
  unscannableTaskIds: string[];
}

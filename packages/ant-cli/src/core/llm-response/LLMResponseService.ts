/**
 * LLMResponseService — single facade for chat emission in worker processes.
 *
 * Substrate (chat-SSOT §5):
 *  - `chat.jsonl` (durable SSOT for finalized lines) via `ChatLogAppender`.
 *  - Redis TURN_BUFFER (in-flight `text` / `thinking` / `pendingCards`)
 *    via `StateStorePort`.
 *  - SSE pub/sub (`chat_event_appended` / `streaming_delta` / …) via
 *    `MessageBroadcaster`.
 *
 * Replaces the legacy chat scratchpad — `SessionStore.messages /
 * currentMessage`, `ContentMerger`, `ChatStatusHandler`, `LLMEventHandler`,
 * `FileOperationHandler`, `CommandExecutionHandler` — with a stateless,
 * append-only emission path. Every public method preserves the historical
 * caller contract; the underlying mechanism is the only thing that changed.
 */

import * as crypto from 'crypto';
import {
  generateChatStatusContent,
  type ChatLine,
  type ChatStatusLine,
  type ChatStatusType,
  type ChatThinkingLine,
  type ChatAssistantMessageLine,
  type ChatChoicePresentedLine,
  type ChatChoiceResolvedLine,
  type LogJobType,
  type PendingCardSnapshot,
} from '@ant/shared';
import type { LLMStreamEvent } from '../ports/llm';
import type { StateStorePort } from '../ports/stateStore';
import type { LLMResponseEnv } from './types';
import { TurnContext } from './TurnContext';
import { ChatLogAppender } from './ChatLogAppender';
import { MessageBroadcaster } from '../chat/MessageBroadcaster';
import { setChatLogAppender, clearChatLogAppender } from './chatLogAppenderRegistry';
import { getChatSyncChannel, REDIS_KEYS } from '../constants/redis';

/**
 * 7-day TTL for the `cardId → turnId` Redis index. Long enough to cover
 * users returning to a stale choice card; bounded so dead cardIds expire
 * naturally. The file-based `chat.jsonl` remains the durable record past
 * the TTL window.
 */
const CHOICE_CARD_INDEX_TTL_SECONDS = 604800;
import { logger } from '../../utils/logger';
import { transformAndStrip } from '../streaming/OutputTagRegistry';

// ═══════════════════════════════════════════════════════════════════════
// Status-type taxonomy
// ═══════════════════════════════════════════════════════════════════════

/**
 * Progress half of every "~ing → ~ed" pair. Emission registers a
 * pending card on the TURN_BUFFER and broadcasts a `streaming_delta`
 * heartbeat for the client to render the loading state. No chat.jsonl
 * line is written — replay reproduces the card from the paired terminal
 * line.
 */
const PROGRESS_STATUS_TYPES: ReadonlySet<ChatStatusType> = new Set([
  'exploring',
  'retrieving',
  'grepping',
  'reading',
  'reading_source',
  'listing_files',
  'searching_code',
  'searching_reference',
  'indexing',
  'analyzing',
  'storing',
  'learning',
  'loading',
  'processing',
  'downloading',
  'figma_calling',
  'plan_generating',
  'task_response_streaming',
  'command_running',
  'command_streaming',
  'file_creating',
  'file_writing',
  'file_editing',
  'file_updating',
  'file_deleting',
]);

/**
 * Tools whose dedicated handler emits its own `chat_status` pair —
 * generic `tool_use` events for these names are no-ops in `sendLLMEvent`.
 * Mirrors the legacy `LLMEventHandler.TOOLS_WITH_DEDICATED_STATUS` set.
 */
const TOOLS_WITH_DEDICATED_STATUS: ReadonlySet<string> = new Set([
  'read_file',
  'list_files',
  'search_code',
  'run_command',
  'search_reference_code',
]);

// ═══════════════════════════════════════════════════════════════════════
// Worker-local trackers
// ═══════════════════════════════════════════════════════════════════════

/**
 * Per-worker trackers for cardId pairing. The legacy substrate carried
 * these on the per-message scratchpad; they now live on the service so
 * the new TURN_BUFFER channel can be addressed without re-hydrating a
 * `ChatMessage`.
 */
interface WorkerLocalState {
  /** filePath → cardId for `reading` / `reading_source` / file-* progress. */
  fileCardByPath: Map<string, string>;
  /** command → cardId for `command_running` → `command` pairing. */
  commandCardByCommand: Map<string, string>;
  /** Active thinking block tracker (start time + cardId). */
  thinking: { cardId: string; startTime: number } | null;
}

function makeWorkerState(): WorkerLocalState {
  return {
    fileCardByPath: new Map(),
    commandCardByCommand: new Map(),
    thinking: null,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// LLMResponseService
// ═══════════════════════════════════════════════════════════════════════

export class LLMResponseService {
  private readonly enabled: boolean;
  private readonly stateStore: StateStorePort;
  private readonly turnContext: TurnContext;
  private readonly broadcaster: MessageBroadcaster;
  private chatLogAppender: ChatLogAppender | null = null;

  /** Cached jobType for `lineBase` — separate from the appender so the
   * service can still build lines when the appender is missing (best-
   * effort broadcast-only path). Defaults to `'code'` to match the
   * pre-rewrite default. */
  private readonly jobType: LogJobType;

  /** Authoritative turnId for this service. Mirrored into the appender
   * (when present) so chat.jsonl writes attach the same id. Tracking it
   * locally keeps emissions working even in test environments / paths
   * where no appender was constructed (no `featurePath`). */
  private turnId: string | null = null;

  /** Sync channel subscription handle (cleanup on dispose). */
  private syncUnsubscribe: (() => Promise<void>) | null = null;

  /** Per-worker-scope trackers (`_main_` / `worker-N`). */
  private readonly workerStates = new Map<string, WorkerLocalState>();

  constructor(stateStore: StateStorePort, env: LLMResponseEnv) {
    this.stateStore = stateStore;
    this.turnContext = new TurnContext(env);
    this.broadcaster = new MessageBroadcaster(stateStore);
    this.jobType = (env.jobType ?? 'code') as LogJobType;

    // Wire chat.jsonl appender whenever we have the minimum env. Initial
    // turnId is unset — the orchestrator calls `setTurnId` after
    // `recordUserTurn` returns.
    if (env.featurePath && env.jobId && env.jobType) {
      this.chatLogAppender = new ChatLogAppender({
        featurePath: env.featurePath,
        jobId: env.jobId,
        jobType: env.jobType,
        agent: env.agent,
        projectId: env.projectId,
        featureName: env.featureName,
      });
      setChatLogAppender(this.chatLogAppender);
    }

    this.enabled = !!(env.projectId && env.featureName && env.jobId);
    if (this.enabled) {
      logger.info(
        `LLMResponseService initialized: ${env.projectId}/${env.featureName} (Job: ${env.jobId})`,
        { component: 'LLMResponseService' },
      );
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // Lifecycle
  // ═══════════════════════════════════════════════════════════════════

  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Update the active turnId for chat.jsonl appends. Called by the
   * orchestrator after `recordUserTurn` resolves — before that point
   * there is no turnId to attach to trace lines, so emissions silently
   * no-op.
   */
  setTurnId(turnId: string | null): void {
    this.turnId = turnId;
    if (this.chatLogAppender) {
      this.chatLogAppender.setTurnId(turnId);
    }
    if (turnId) {
      // Subscribe to sync channel exactly once per turn so SSE API Pod
      // reconnects can ask the worker for an in-flight buffer snapshot.
      void this.subscribeSyncChannel();
    }
  }

  /** Drain pending broadcaster publishes before the worker process exits. */
  async drainBroadcaster(): Promise<void> {
    await this.broadcaster.drain();
  }

  /**
   * Peek the turnId-level pause sequence (`pauseSeq`) — diagnostic
   * surface only. Workers MUST use {@link nextWorkerCycleSeq} /
   * {@link getCurrentWorkerCycleSeq} for the `worker-N#task-K#p{n}`
   * scope suffix; this helper remains for legacy callers and tooling
   * that inspect the cancellation counter directly.
   *
   * GET-only (peek). The INCR side stays with the cancellation path
   * (`ChatService.appendChoicePresentedCancelled`) so workers cannot
   * race-skip a pauseSeq.
   */
  async getCurrentPauseSeq(): Promise<number> {
    if (!this.enabled) return 0;
    const turnId = this.getTurnId();
    if (!turnId) return 0;
    try {
      return await this.stateStore.getCurrentPauseSeq(turnId);
    } catch (err) {
      logger.warn(
        `getCurrentPauseSeq failed for turnId=${turnId}`,
        { component: 'LLMResponseService' },
        err,
      );
      return 0;
    }
  }

  /**
   * INCR + return the per-(turn, task) worker cycle sequence used as
   * the `worker-N#task-K#p{cycleSeq}` chat scope suffix. Called by
   * `TaskWorker.executeTask` when it picks up a task that bears a
   * re-entry marker (`task.interrupted === true` or
   * `task._failedAttempts > 0`). The fresh value isolates the cycle's
   * `WorkerLocalState` slot inside this service so stale
   * `fileCardByPath` / `commandCardByCommand` / `thinking` entries
   * from a prior cycle cannot leak into the new cycle's chat events
   * (verification re-entry stale-card RCA).
   *
   * Returns 0 on failure (best-effort) — callers must handle the
   * fallback gracefully (the worker emits with the legacy two-axis
   * scope rather than aborting on a Redis blip).
   */
  async nextWorkerCycleSeq(taskKey: string): Promise<number> {
    if (!this.enabled) return 0;
    const turnId = this.getTurnId();
    if (!turnId) return 0;
    try {
      return await this.stateStore.nextWorkerCycleSeq(turnId, taskKey);
    } catch (err) {
      logger.warn(
        `nextWorkerCycleSeq failed for turnId=${turnId}, taskKey=${taskKey}`,
        { component: 'LLMResponseService' },
        err,
      );
      return 0;
    }
  }

  /**
   * Peek (GET-only) the current worker cycle sequence for a
   * (turn, task) pair. Returns 0 when no re-entry has been recorded
   * yet — the worker uses this on fresh task entry to handle the
   * cross-process resume case (a different process may have INCRed
   * the counter before crashing).
   */
  async getCurrentWorkerCycleSeq(taskKey: string): Promise<number> {
    if (!this.enabled) return 0;
    const turnId = this.getTurnId();
    if (!turnId) return 0;
    try {
      return await this.stateStore.getCurrentWorkerCycleSeq(turnId, taskKey);
    } catch (err) {
      logger.warn(
        `getCurrentWorkerCycleSeq failed for turnId=${turnId}, taskKey=${taskKey}`,
        { component: 'LLMResponseService' },
        err,
      );
      return 0;
    }
  }

  /**
   * Tear down the process-scoped chat-log appender registration. Tests
   * that construct multiple service instances in one process call this
   * between cases; production workers exit immediately after the job.
   */
  disposeChatLogAppender(): void {
    if (this.chatLogAppender) {
      clearChatLogAppender();
      this.chatLogAppender = null;
    }
  }

  /**
   * Finalize the in-flight turn buffer: drain text/thinking into chat.jsonl
   * and clear the per-worker streaming buffer. `cancelled=true` skips the
   * assistant_message persist and clears any partial thinking block.
   */
  async finalizeMessage(cancelled: boolean = false): Promise<void> {
    if (!this.enabled) return;
    const turnId = this.getTurnId();
    if (!turnId) return;

    try {
      if (!cancelled) {
        await this.flushThinkingBuffer();
        await this.flushTextBuffer();
      } else {
        await this.clearTurnBuffer();
        // Reset thinking tracker so the next turn starts fresh.
        const ws = this.getWorkerState();
        ws.thinking = null;
      }
    } catch (error) {
      logger.warn(`finalizeMessage failed`, { component: 'LLMResponseService' }, error);
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // Finalized lines (chat.jsonl + chat_event_appended SSE)
  // ═══════════════════════════════════════════════════════════════════

  async appendThinking(text: string, cardId?: string, durationMs?: number): Promise<void> {
    if (!this.enabled || !text || !this.getTurnId()) return;
    const line: ChatThinkingLine = {
      ...this.lineBase('assistant_thinking'),
      type: 'assistant_thinking',
      text,
      ...(typeof durationMs === 'number' ? { durationMs } : {}),
      ...(cardId ? { cardId } : {}),
    };
    await this.persistAndBroadcast(line);
  }

  async appendChatStatus(
    cardId: string,
    statusType: ChatStatusType,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    if (!this.enabled || !cardId || !this.getTurnId()) return;
    const line: ChatStatusLine = {
      ...this.lineBase('chat_status'),
      type: 'chat_status',
      cardId,
      statusType,
      metadata,
    };
    // Clearing any pending card with the same id keeps TURN_BUFFER clean
    // when a progress→terminal transition finalizes here.
    await this.clearPendingCardSafe(cardId);
    await this.persistAndBroadcast(line);
  }

  async appendAssistantMessage(text: string): Promise<void> {
    if (!this.enabled || !text || !this.getTurnId()) return;
    const line: ChatAssistantMessageLine = {
      ...this.lineBase('assistant_message'),
      type: 'assistant_message',
      text,
    };
    await this.persistAndBroadcast(line);
  }

  async appendChoicePresented(args: {
    cardId: string;
    cardType: string;
    prompt?: string;
    payload?: Record<string, unknown>;
  }): Promise<void> {
    if (!this.enabled || !args.cardId || !this.getTurnId()) return;
    const base = this.lineBase('choice_presented');
    // Synthetic per-card workerScope for `spec_complete` so the card
    // lands in its own FE section and sorts chronologically below the
    // spec body emitted by parallel TaskWorkers. Without this the card
    // inherits the `_main_` workerScope (no scope on the line) and
    // `selectTurns` pins `_main_` to the first section regardless of
    // ts — producing the "turn reversal" where the completion card
    // appears above the spec it is summarising. Mirrors the cancelled
    // card pattern (`ChatService.appendChoicePresentedCancelled`).
    const workerScope =
      args.cardType === 'spec_complete'
        ? `_spec_complete_:${args.cardId}`
        : (base as { workerScope?: string }).workerScope;
    const line: ChatChoicePresentedLine = {
      ...base,
      ...(workerScope ? { workerScope } : {}),
      type: 'choice_presented',
      cardId: args.cardId,
      cardType: args.cardType,
      prompt: args.prompt,
      payload: args.payload,
    };
    await this.persistAndBroadcast(line);
  }

  async appendChoiceResolved(args: {
    cardId: string;
    choiceSelected: string;
    resolvedLabel: string;
    answer?: Record<string, unknown>;
  }): Promise<void> {
    if (!this.enabled || !args.cardId || !this.getTurnId()) return;
    const line: ChatChoiceResolvedLine = {
      ...this.lineBase('choice_resolved'),
      type: 'choice_resolved',
      cardId: args.cardId,
      choiceSelected: args.choiceSelected,
      resolvedLabel: args.resolvedLabel,
      answer: args.answer,
    };
    await this.persistAndBroadcast(line);
  }

  // ═══════════════════════════════════════════════════════════════════
  // In-flight streaming (TURN_BUFFER + streaming_delta SSE)
  // ═══════════════════════════════════════════════════════════════════

  async streamThinkingChunk(chunk: string, cardId?: string): Promise<void> {
    if (!this.enabled || !chunk) return;
    const turnId = this.getTurnId();
    if (!turnId) return;
    const ws = this.getWorkerState();
    if (!ws.thinking) {
      ws.thinking = {
        cardId: cardId ?? this.mintCardId('think'),
        startTime: Date.now(),
      };
    }
    await this.appendBufferKind(turnId, 'thinking', chunk, undefined);
    this.broadcaster.broadcastStreamingDelta(
      this.turnContext.context.projectId,
      this.turnContext.context.featureName,
      {
        turnId,
        workerScope: this.workerScopeForLine(),
        kind: 'thinking',
        cardId: ws.thinking.cardId,
        chunk,
      },
      this.turnContext.context.userContext,
    );
  }

  async streamTextChunk(chunk: string): Promise<void> {
    if (!this.enabled || !chunk) return;
    const turnId = this.getTurnId();
    if (!turnId) return;
    await this.appendBufferKind(turnId, 'text', chunk, undefined);
    this.broadcaster.broadcastStreamingDelta(
      this.turnContext.context.projectId,
      this.turnContext.context.featureName,
      {
        turnId,
        workerScope: this.workerScopeForLine(),
        kind: 'text',
        chunk,
      },
      this.turnContext.context.userContext,
    );
  }

  async registerPendingCard(
    cardId: string,
    statusType: ChatStatusType,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    if (!this.enabled || !cardId) return;
    const turnId = this.getTurnId();
    if (!turnId) return;
    const sessionKey = this.turnContext.context.sessionKey;
    const scope = this.turnContext.getWorkerScopeKey();
    const pendingMetadata: Record<string, unknown> = { ...(metadata ?? {}) };
    if (typeof pendingMetadata.jobType !== 'string') {
      pendingMetadata.jobType = this.jobType;
    }
    const card: PendingCardSnapshot = {
      cardId,
      statusType,
      metadata: pendingMetadata,
    };
    await this.stateStore
      .setTurnBufferPendingCard(sessionKey, turnId, scope, card)
      .catch((err) =>
        logger.warn(`setTurnBufferPendingCard failed`, { component: 'LLMResponseService' }, err),
      );
    // Broadcast the FULL buffer snapshot so the FE projector has the
    // correct `statusType` for the new pendingCard before any non-empty
    // `card_output` chunk arrives. The `streaming_delta` schema only
    // carries `cardId + chunk` — no `statusType` — so a zero-length
    // delta cannot communicate "this is a plan_generating /
    // file_creating / … shell". The FE's `applyStreamingDelta` correctly
    // drops empty chunks and would otherwise default-fallback to
    // `statusType: 'tool_action'` on the first real chunk, producing a
    // wrongly-typed loading shell visible during live streaming.
    // Reading the buffer back after our `setTurnBufferPendingCard`
    // write keeps the snapshot atomically consistent with any other
    // in-flight `text` / `thinking` / `pendingCards` in the same
    // (turnId, workerScope).
    const buffer = await this.stateStore
      .getTurnBuffer(sessionKey, turnId, scope)
      .catch(() => null);
    this.broadcaster.broadcastStreamingBufferSnapshot(
      this.turnContext.context.projectId,
      this.turnContext.context.featureName,
      {
        turnId,
        workerScope: this.workerScopeForLine(),
        text: buffer?.text,
        thinking: buffer?.thinking,
        pendingCards: buffer?.pendingCards,
      },
      this.turnContext.context.userContext,
    );
  }

  async streamCardOutput(cardId: string, chunk: string): Promise<void> {
    if (!this.enabled || !cardId || !chunk) return;
    const turnId = this.getTurnId();
    if (!turnId) return;
    await this.appendBufferKind(turnId, 'card_output', chunk, cardId);
    this.broadcaster.broadcastStreamingDelta(
      this.turnContext.context.projectId,
      this.turnContext.context.featureName,
      {
        turnId,
        workerScope: this.workerScopeForLine(),
        kind: 'card_output',
        cardId,
        chunk,
      },
      this.turnContext.context.userContext,
    );
  }

  async finalizePendingCard(
    cardId: string,
    statusType: ChatStatusType,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    await this.appendChatStatus(cardId, statusType, metadata);
  }

  // ═══════════════════════════════════════════════════════════════════
  // Buffer flush helpers
  // ═══════════════════════════════════════════════════════════════════

  async flushThinkingBuffer(cardId?: string, durationMs?: number): Promise<void> {
    if (!this.enabled) return;
    const turnId = this.getTurnId();
    if (!turnId) return;
    const buffer = await this.stateStore
      .getTurnBuffer(
        this.turnContext.context.sessionKey,
        turnId,
        this.turnContext.getWorkerScopeKey(),
      )
      .catch(() => null);
    const ws = this.getWorkerState();
    const text = buffer?.thinking?.trim();
    const finalCardId = cardId ?? ws.thinking?.cardId;
    if (text && text.length > 0) {
      await this.appendThinking(text, finalCardId, durationMs);
    }
    // Clear ONLY the thinking field — text and pendingCards live on.
    if (buffer) {
      const next = { ...buffer, thinking: undefined };
      await this.replaceTurnBuffer(turnId, next);
    }
    ws.thinking = null;
  }

  async flushTextBuffer(): Promise<void> {
    if (!this.enabled) return;
    const turnId = this.getTurnId();
    if (!turnId) return;
    const buffer = await this.stateStore
      .getTurnBuffer(
        this.turnContext.context.sessionKey,
        turnId,
        this.turnContext.getWorkerScopeKey(),
      )
      .catch(() => null);
    const rawText = buffer?.text?.trim();
    if (rawText && rawText.length > 0) {
      // Streaming chunks may have split a canonical tag across chunk
      // boundaries — `SpecialTagTransformer` is single-shot per chunk
      // and would have let the partial through as raw text. Rerun the
      // registry's transform over the full buffer at flush time so any
      // complete tag in the accumulated text renders properly (or
      // strips, for suppressed-axis entries) before the line lands in
      // chat.jsonl as `assistant_message`.
      const cleaned = transformAndStrip(rawText, 'en').trim();
      if (cleaned.length > 0) {
        await this.appendAssistantMessage(cleaned);
      }
    }
    if (buffer) {
      const next = { ...buffer, text: undefined };
      await this.replaceTurnBuffer(turnId, next);
    }
  }

  async clearTurnBuffer(): Promise<void> {
    if (!this.enabled) return;
    const turnId = this.getTurnId();
    if (!turnId) return;
    await this.stateStore
      .clearTurnBuffer(
        this.turnContext.context.sessionKey,
        turnId,
        this.turnContext.getWorkerScopeKey(),
      )
      .catch((err) =>
        logger.warn(`clearTurnBuffer failed`, { component: 'LLMResponseService' }, err),
      );

    // Match the flush-path contract (see `replaceTurnBuffer` →
    // `streaming_buffer_snapshot`): emit an empty snapshot so the FE
    // projector clears its in-memory `streamingBuffers[key]` mirror.
    // Without this signal a cancelled turn leaves stale
    // `activeText`/`activeThinking`/`pendingCards` overlays beneath the
    // durable lines just persisted, which on a Stop+parallel scenario
    // surfaces as ghost output sitting next to the cancelled card.
    this.broadcaster.broadcastStreamingBufferSnapshot(
      this.turnContext.context.projectId,
      this.turnContext.context.featureName,
      {
        turnId,
        workerScope: this.workerScopeForLine(),
        text: '',
        thinking: '',
        pendingCards: {},
      },
      this.turnContext.context.userContext,
    );
  }

  // ═══════════════════════════════════════════════════════════════════
  // Compat — `showChatStatus` / `removeChatStatus`
  //
  // Returns a `cardId` (string) so callers can chain progress → terminal
  // emissions via `metadata._mergeIndex`. Pre-§5 callers passed a numeric
  // contents-array index; the field name stays for type-loose backwards
  // compatibility (Record<string, any>), only the value type changed.
  // ═══════════════════════════════════════════════════════════════════

  async showChatStatus(
    type: ChatStatusType,
    metadata?: Record<string, any>,
  ): Promise<string | undefined> {
    if (!this.enabled) return undefined;
    if (!this.getTurnId()) return undefined;

    if (type === 'placeholder' || type === 'thinking') {
      // Live-only signals — no chat.jsonl persistence and no buffer
      // entry. Placeholder is rendered by the FE as a transient shimmer
      // when no other in-flight content exists; the thinking stream is
      // driven by `streamThinkingChunk` from `sendLLMEvent`.
      return undefined;
    }

    if (type === 'triage_choice' || type === 'choice_card') {
      const cardId = (metadata?.cardId as string | undefined) ?? this.mintCardId('choice');
      const cardType =
        type === 'triage_choice'
          ? 'triage_choice'
          : (metadata?.cardType as string | undefined) ?? 'choice_card';
      const prompt = generateChatStatusContent(type, metadata);
      const {
        cardId: _ci,
        cardType: _ct,
        provider: _p,
        timestamp: _ts,
        message: _m,
        ...restPayload
      } = metadata ?? {};
      const payload = {
        ...restPayload,
        ...(metadata?.message !== undefined ? { message: metadata.message } : {}),
      } as Record<string, unknown>;
      await this.appendChoicePresented({ cardId, cardType, prompt, payload });
      return cardId;
    }

    const carry =
      (metadata?.cardId as string | undefined) ?? (metadata?._mergeIndex as string | undefined);
    const cardId = carry ?? this.mintCardId();

    const persistedMetadata = stripInternalKeys({ ...(metadata ?? {}) });
    persistedMetadata.cardId = cardId;

    if (PROGRESS_STATUS_TYPES.has(type)) {
      // Track common chaining keys so the paired terminal emission can
      // resolve the cardId without the caller passing it back.
      const ws = this.getWorkerState();
      const filePath = metadata?.filePath as string | undefined;
      const command = metadata?.command as string | undefined;
      if (filePath) ws.fileCardByPath.set(filePath, cardId);
      if (command) ws.commandCardByCommand.set(command, cardId);
      await this.registerPendingCard(cardId, type, persistedMetadata);
      return cardId;
    }

    // Terminal / unknown — persist a chat_status line. Cleanup the
    // matching tracker entry on file/command terminals so the next
    // emission for the same key starts fresh.
    if (type === 'read' || type === 'read_source') {
      const filePath = metadata?.filePath as string | undefined;
      if (filePath) this.getWorkerState().fileCardByPath.delete(filePath);
    } else if (type === 'command') {
      const command = metadata?.command as string | undefined;
      if (command) this.getWorkerState().commandCardByCommand.delete(command);
    }
    await this.appendChatStatus(cardId, type, persistedMetadata);
    return cardId;
  }

  /**
   * Remove the in-flight pending card identified by `cardId`. Used by
   * legacy "progress with 0 results → drop the spinner" flows
   * (`semanticSearch.removeChatStatus(retrievingIndex)` etc.). chat.jsonl
   * is unaffected because progress cards never persist.
   */
  async removeChatStatus(cardId: string, _expectedType?: string): Promise<void> {
    if (!this.enabled || !cardId) return;
    const turnId = this.getTurnId();
    if (!turnId) return;
    const sessionKey = this.turnContext.context.sessionKey;
    const scope = this.turnContext.getWorkerScopeKey();
    await this.stateStore
      .clearTurnBufferPendingCard(
        sessionKey,
        turnId,
        scope,
        cardId,
      )
      .catch((err) =>
        logger.warn(`removeChatStatus failed`, { component: 'LLMResponseService' }, err),
      );
    // Keep FE `streamingBuffers` synchronized with the Redis pending-card
    // cleanup. Without this snapshot, remove-only progress flows
    // (`retrieving`/`listing_files` 0-result paths) can leave ghost
    // pendingCards on the client until another buffer event arrives.
    const buffer = await this.stateStore
      .getTurnBuffer(sessionKey, turnId, scope)
      .catch(() => null);
    this.broadcaster.broadcastStreamingBufferSnapshot(
      this.turnContext.context.projectId,
      this.turnContext.context.featureName,
      {
        turnId,
        workerScope: this.workerScopeForLine(),
        text: buffer?.text,
        thinking: buffer?.thinking,
        pendingCards: buffer?.pendingCards,
      },
      this.turnContext.context.userContext,
    );
  }

  // ═══════════════════════════════════════════════════════════════════
  // Compat — LLM event dispatch
  // ═══════════════════════════════════════════════════════════════════

  async sendLLMEvent(event: LLMStreamEvent): Promise<void> {
    if (!this.enabled || !this.getTurnId()) return;

    try {
      switch (event.type) {
        case 'thinking': {
          const blockEnd = event.metadata?.blockEnd === true;
          const durationMs = event.metadata?.durationMs;
          if (event.thinking) await this.streamThinkingChunk(event.thinking);
          if (blockEnd) await this.flushThinkingBuffer(undefined, durationMs);
          break;
        }
        case 'text': {
          if (event.text && event.text.trim()) {
            await this.streamTextChunk(event.text);
          }
          break;
        }
        case 'tool_use': {
          if (!event.toolUse) break;
          const { name, input } = event.toolUse as { name: string; input: any };
          if (TOOLS_WITH_DEDICATED_STATUS.has(name)) break;
          if (
            name === 'edit_file' ||
            name === 'delete_file' ||
            name === 'file' ||
            name === 'write_file' ||
            name === 'create_file'
          ) {
            // File mutators are emitted via the dedicated FileRenderer
            // path (start*/complete*). The legacy substrate also injected
            // a placeholder MessageContent here to nest the loading
            // shell — that role moves to the file-progress card now.
            break;
          }
          if (name === 'mkdir') {
            const dirPath = input?.path as string | undefined;
            await this.appendChatStatus(this.mintCardId('tool'), 'tool_action', {
              toolName: 'mkdir',
              actionIcon: '📁',
              content: `Created directory: ${dirPath ?? ''}`,
              filePath: dirPath,
            });
            break;
          }
          // Generic fallback — match the legacy summary truncation so the
          // tool_action card body stays readable.
          const summary: Record<string, unknown> = { ...(input ?? {}) };
          for (const key of Object.keys(summary)) {
            if (typeof summary[key] === 'string' && (summary[key] as string).length > 100) {
              summary[key] = `(${(summary[key] as string).length} chars)`;
            }
          }
          const json = JSON.stringify(summary);
          const display = json.length > 200 ? `${name}: ${json.slice(0, 200)}...` : `${name}: ${json}`;
          await this.appendChatStatus(this.mintCardId('tool'), 'tool_action', {
            toolName: name,
            actionIcon: '🔧',
            content: display,
          });
          break;
        }
        case 'error': {
          const message = event.error?.message ?? 'Unknown error';
          await this.streamTextChunk(`❌ Error: ${message}`);
          break;
        }
        case 'done':
          // Caller controls finalize via `finalizeMessage`. No-op here.
          break;
      }
    } catch (error) {
      logger.error(`sendLLMEvent failed`, { component: 'LLMResponseService' }, error);
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // Compat — File operations
  //
  // Each progress emission registers a pending card and remembers the
  // cardId by filePath; the terminal emission finalizes that card via
  // `appendChatStatus` so chat.jsonl carries one line per file event.
  // The legacy `_mergeIndex` chaining is replaced by the per-worker
  // `fileCardByPath` tracker so callers stay churn-free.
  // ═══════════════════════════════════════════════════════════════════

  async startFileCreation(filePath: string): Promise<string> {
    return this.startFileOp(filePath, 'file_creating');
  }

  async streamFileContent(filePath: string, content: string): Promise<void> {
    if (!this.enabled || !filePath || !content) return;
    const cardId = this.getWorkerState().fileCardByPath.get(filePath);
    if (!cardId) return;
    await this.streamCardOutput(cardId, content);
  }

  async completeFileCreation(
    filePath: string,
    content: string,
    stats?: { diffBeforeLines?: number },
  ): Promise<void> {
    await this.completeFileOp(filePath, 'file_create', {
      filePath,
      content,
      ...(stats?.diffBeforeLines !== undefined ? { diffBeforeLines: stats.diffBeforeLines } : {}),
    });
  }

  async startFileEdit(filePath: string): Promise<string> {
    return this.startFileOp(filePath, 'file_editing');
  }

  async streamFileDiff(filePath: string, diffBefore: string, diffAfter: string): Promise<void> {
    if (!this.enabled || !filePath) return;
    const cardId = this.getWorkerState().fileCardByPath.get(filePath);
    if (!cardId) return;
    // Stream the after-diff snapshot — the FE keeps the latest snapshot
    // per cardId. Passing the snapshot (not delta) matches the legacy
    // `streaming` phase which broadcast the full content_update payload.
    await this.streamCardOutput(cardId, diffAfter);
    // diffBefore is captured implicitly via the terminal `file_edit` line
    // metadata; no separate channel is needed here.
    void diffBefore;
  }

  async completeFileEdit(filePath: string, diffBefore: string, diffAfter: string): Promise<void> {
    await this.completeFileOp(filePath, 'file_edit', {
      filePath,
      diffBefore,
      diffAfter,
    });
  }

  async startFileDeletion(filePath: string): Promise<string> {
    return this.startFileOp(filePath, 'file_deleting');
  }

  async completeFileDeletion(filePath: string, content?: string): Promise<void> {
    await this.completeFileOp(filePath, 'file_delete', { filePath, content });
  }

  async failFileEdit(filePath: string, errorMessage: string): Promise<void> {
    await this.completeFileOp(filePath, 'file_edit_failed', {
      filePath,
      reason: errorMessage,
    });
  }

  async failFileCreation(filePath: string, errorMessage: string): Promise<void> {
    await this.completeFileOp(filePath, 'file_create_failed', {
      filePath,
      reason: errorMessage,
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  // Compat — Command execution
  // ═══════════════════════════════════════════════════════════════════

  async startCommand(command: string): Promise<string | undefined> {
    if (!this.enabled || !command || !this.getTurnId()) return undefined;
    const cardId = this.mintCardId('cmd');
    this.getWorkerState().commandCardByCommand.set(command, cardId);
    await this.registerPendingCard(cardId, 'command_running', { command });
    return cardId;
  }

  async streamCommandOutput(command: string, output: string): Promise<void> {
    if (!this.enabled || !command || !output) return;
    const cardId = this.getWorkerState().commandCardByCommand.get(command);
    if (!cardId) return;
    // Callers send accumulated snapshots; downstream consumers (FE)
    // keep the latest snapshot per cardId so passing the full string is
    // semantically correct without delta calculation here.
    await this.streamCardOutput(cardId, output);
  }

  async completeCommand(command: string, output: string, exitCode: number): Promise<void> {
    if (!this.enabled || !this.getTurnId()) return;
    const ws = this.getWorkerState();
    const cardId = ws.commandCardByCommand.get(command) ?? this.mintCardId('cmd');
    ws.commandCardByCommand.delete(command);
    await this.appendChatStatus(cardId, 'command', {
      command,
      exitCode,
      output: truncateOutput(output),
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  // Compat — Legacy helper aliases
  // ═══════════════════════════════════════════════════════════════════

  async addCommandExecution(command: string, output?: string, exitCode?: number): Promise<void> {
    if (!this.enabled) return;
    await this.completeCommand(command, output ?? '', exitCode ?? 0);
  }

  async addExploringStatus(current: number, total: number): Promise<void> {
    await this.showChatStatus('exploring', { filesCount: current, totalFiles: total });
  }

  async addExploredResult(filesCount: number, filesList?: string[]): Promise<void> {
    await this.showChatStatus('explored', { filesCount, filesList });
  }

  async addReadingFile(
    filePath: string,
    startLine?: number,
    endLine?: number,
  ): Promise<string | undefined> {
    return this.showChatStatus('reading', { filePath, startLine, endLine });
  }

  async addReadComplete(
    filePath: string,
    readingCardId?: string,
    opts?: {
      error?: string;
      totalLines?: number;
      startLine?: number;
      endLine?: number;
    },
  ): Promise<void> {
    await this.showChatStatus('read', {
      filePath,
      ...(opts?.error ? { error: opts.error } : {}),
      ...(opts?.startLine !== undefined ? { startLine: opts.startLine } : {}),
      ...(opts?.endLine !== undefined ? { endLine: opts.endLine } : {}),
      ...(opts?.totalLines !== undefined ? { totalLines: opts.totalLines } : {}),
      ...(readingCardId ? { _mergeIndex: readingCardId } : {}),
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  // Internals — line construction + persist+broadcast
  // ═══════════════════════════════════════════════════════════════════

  private getTurnId(): string | null {
    return this.turnId;
  }

  private workerScopeForLine(): string | undefined {
    const key = this.turnContext.getWorkerScopeKey();
    return key === '_main_' ? undefined : key;
  }

  private getWorkerState(): WorkerLocalState {
    const key = this.turnContext.getWorkerScopeKey();
    let ws = this.workerStates.get(key);
    if (!ws) {
      ws = makeWorkerState();
      this.workerStates.set(key, ws);
    }
    return ws;
  }

  private mintCardId(prefix: string = 'card'): string {
    return `${prefix}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  }

  /**
   * Common metadata header used by every line emitted from this service.
   * `workerScope` is omitted on the main graph and set to `worker-N`
   * (no active task) or `worker-N#task-K` (within a task) by
   * `TurnContext.getWorkerScopeKey()`. The `#task-K` suffix lets the
   * FE projector partition long-lived worker output per task and sort
   * sections chronologically (matches the LineBase contract documented
   * in `@ant/shared/session-log.ts`).
   */
  private lineBase(_kind: ChatLine['type']) {
    const turnId = this.getTurnId();
    const ws = this.workerScopeForLine();
    return {
      ts: new Date().toISOString(),
      jobId: this.turnContext.context.jobId,
      turnId: (turnId ?? '') as string,
      jobType: this.jobType,
      ...(ws ? { workerScope: ws } : {}),
    };
  }

  private async persistAndBroadcast(line: ChatLine): Promise<void> {
    if (this.chatLogAppender) {
      this.chatLogAppender.appendChatLine(line);
    }
    if (line.type === 'choice_presented') {
      this.indexChoicePresented(line as ChatChoicePresentedLine);
    }
    this.broadcaster.broadcastChatLine(
      this.turnContext.context.projectId,
      this.turnContext.context.featureName,
      line,
      this.turnContext.context.userContext,
    );
  }

  /**
   * Mirror a `choice_presented` line into Redis so the API-server's
   * `/chat/choice-resolved` handler can resolve `cardId → turnId` without
   * waiting for NFS read-after-write visibility on the worker-written
   * `chat.jsonl`. Fire-and-forget — file remains the durable record.
   */
  private indexChoicePresented(line: ChatChoicePresentedLine): void {
    if (!line.cardId || !line.turnId) return;
    const key = `${REDIS_KEYS.CHOICE.CARD_INDEX}${line.cardId}`;
    const value = JSON.stringify({
      turnId: line.turnId,
      jobId: line.jobId,
      jobType: line.jobType,
      ...(line.workerScope ? { workerScope: line.workerScope } : {}),
    });
    this.stateStore.setKeyWithTTL(key, value, CHOICE_CARD_INDEX_TTL_SECONDS).catch((err) => {
      logger.warn(
        `[LLMResponseService] choice-card index SET failed: ${(err as Error)?.message ?? err}`,
        { component: 'LLMResponseService' },
      );
    });
  }

  private async appendBufferKind(
    turnId: string,
    kind: 'text' | 'thinking' | 'card_output',
    chunk: string,
    cardId?: string,
  ): Promise<void> {
    await this.stateStore
      .appendToTurnBuffer(
        this.turnContext.context.sessionKey,
        turnId,
        this.turnContext.getWorkerScopeKey(),
        kind,
        chunk,
        cardId,
      )
      .catch((err) =>
        logger.warn(`appendToTurnBuffer(${kind}) failed`, { component: 'LLMResponseService' }, err),
      );
  }

  private async clearPendingCardSafe(cardId: string): Promise<void> {
    const turnId = this.getTurnId();
    if (!turnId) return;
    await this.stateStore
      .clearTurnBufferPendingCard(
        this.turnContext.context.sessionKey,
        turnId,
        this.turnContext.getWorkerScopeKey(),
        cardId,
      )
      .catch(() => {
        // best-effort; missing card or transient redis error is ignored.
      });
  }

  /**
   * Replace the buffer contents for the active `(turnId, workerScope)`
   * pair. Used by the flush helpers to drop just the `text` or
   * `thinking` field while preserving `pendingCards`. Implemented as
   * clear + re-append since the StateStorePort lacks a single-shot
   * "set whole buffer" primitive; the operation is idempotent and the
   * key TTL is refreshed on every write.
   *
   * After the Redis write succeeds, broadcasts a
   * `streaming_buffer_snapshot` SSE so the FE projector clears its
   * in-memory `streamingBuffers[key]` mirror. Without this signal the
   * FE keeps the previously streamed `activeText`/`activeThinking` and
   * renders it as an overlay alongside the durable `assistant_message`
   * / `assistant_thinking` ChatLine, producing duplicate text in the
   * UI (chat-SSOT regression seen in detect/decompose phases).
   */
  private async replaceTurnBuffer(
    turnId: string,
    next: { text?: string; thinking?: string; pendingCards?: Record<string, PendingCardSnapshot> },
  ): Promise<void> {
    const sessionKey = this.turnContext.context.sessionKey;
    const scope = this.turnContext.getWorkerScopeKey();
    try {
      await this.stateStore.clearTurnBuffer(sessionKey, turnId, scope);
      if (next.text) {
        await this.stateStore.appendToTurnBuffer(sessionKey, turnId, scope, 'text', next.text);
      }
      if (next.thinking) {
        await this.stateStore.appendToTurnBuffer(
          sessionKey,
          turnId,
          scope,
          'thinking',
          next.thinking,
        );
      }
      if (next.pendingCards) {
        for (const card of Object.values(next.pendingCards)) {
          await this.stateStore.setTurnBufferPendingCard(sessionKey, turnId, scope, card);
        }
      }
      this.broadcaster.broadcastStreamingBufferSnapshot(
        this.turnContext.context.projectId,
        this.turnContext.context.featureName,
        {
          turnId,
          workerScope: this.workerScopeForLine(),
          text: next.text,
          thinking: next.thinking,
          pendingCards: next.pendingCards,
        },
        this.turnContext.context.userContext,
      );
    } catch (err) {
      logger.warn(`replaceTurnBuffer failed`, { component: 'LLMResponseService' }, err);
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // Internals — file op helpers
  // ═══════════════════════════════════════════════════════════════════

  private async startFileOp(
    filePath: string,
    progressType: 'file_creating' | 'file_editing' | 'file_deleting',
  ): Promise<string> {
    if (!this.enabled || !filePath || !this.getTurnId()) return '';
    const cardId = this.mintCardId('file');
    this.getWorkerState().fileCardByPath.set(filePath, cardId);
    await this.registerPendingCard(cardId, progressType, { filePath });
    return cardId;
  }

  private async completeFileOp(
    filePath: string,
    terminalType: ChatStatusType,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    if (!this.enabled || !filePath || !this.getTurnId()) return;
    const ws = this.getWorkerState();
    const cardId = ws.fileCardByPath.get(filePath) ?? this.mintCardId('file');
    ws.fileCardByPath.delete(filePath);
    await this.appendChatStatus(cardId, terminalType, metadata);
  }

  // ═══════════════════════════════════════════════════════════════════
  // Sync channel — reconnect snapshot
  // ═══════════════════════════════════════════════════════════════════

  private async subscribeSyncChannel(): Promise<void> {
    if (this.syncUnsubscribe) return;
    try {
      const channel = getChatSyncChannel(this.turnContext.context.sessionKey);
      const unsubscribe = await this.stateStore.subscribe(channel, () => {
        void this.handleSyncRequest();
      });
      this.syncUnsubscribe = unsubscribe as () => Promise<void>;
      logger.debug(`Subscribed to sync channel: ${channel}`, {
        component: 'LLMResponseService',
      });
    } catch (error) {
      logger.warn(`Failed to subscribe to sync channel`, { component: 'LLMResponseService' }, error);
    }
  }

  private async handleSyncRequest(): Promise<void> {
    if (!this.enabled) return;
    try {
      const snapshots = await this.stateStore.listActiveTurnBuffers(
        this.turnContext.context.sessionKey,
      );
      for (const snap of snapshots) {
        this.broadcaster.broadcastStreamingBufferSnapshot(
          this.turnContext.context.projectId,
          this.turnContext.context.featureName,
          {
            turnId: snap.turnId,
            workerScope: snap.workerScope === '_main_' ? undefined : snap.workerScope,
            text: snap.text,
            thinking: snap.thinking,
            pendingCards: snap.pendingCards,
          },
          this.turnContext.context.userContext,
        );
      }
      logger.debug(`Handled sync request: emitted ${snapshots.length} buffer snapshot(s)`, {
        component: 'LLMResponseService',
      });
    } catch (error) {
      logger.error(`Failed to handle sync request`, { component: 'LLMResponseService' }, error);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════

/**
 * Strip ContentMerger-era internal metadata keys before persisting. The
 * pre-§5 substrate used `_mergeIndex` and friends to drive the contents
 * array merge; in the chat-SSOT model the cardId itself carries that
 * identity so these keys would only pollute chat.jsonl.
 */
function stripInternalKeys(metadata: Record<string, any>): Record<string, any> {
  const {
    _mergeIndex: _mi,
    _preserveContent: _pc,
    provider: _p,
    timestamp: _ts,
    cardId: _ci,
    ...rest
  } = metadata;
  return rest;
}

/**
 * Cap stdout captured in chat.jsonl so a noisy command does not inflate
 * the UI log. UI tail rendering only shows first/last few KB; anything
 * longer is not actionable context.
 */
function truncateOutput(output: string | undefined, max = 4000): string | undefined {
  if (!output) return output;
  if (output.length <= max) return output;
  const head = output.slice(0, Math.floor(max * 0.75));
  const tail = output.slice(-Math.floor(max * 0.2));
  return `${head}\n…(${output.length - max} chars truncated)…\n${tail}`;
}

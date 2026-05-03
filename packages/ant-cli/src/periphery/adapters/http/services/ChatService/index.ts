/**
 * ChatService — HTTP-side facade for chat.jsonl + TURN_BUFFER + SSE.
 *
 * Companion to the worker-side `LLMResponseService` (see chat-SSOT §5).
 * Both shoulder the same emission contract — chat.jsonl writes through
 * `FileSessionAdapter` + a `MessageBroadcaster` SSE publish + the Redis
 * TURN_BUFFER for in-flight streaming — but they fire from different
 * processes and serve different purposes:
 *
 *   - `LLMResponseService` (job worker)
 *       runs inside the spawned tsx worker, owns the per-turn emission
 *       for tool / file / command / LLM stream events.
 *   - `ChatService` (this class, HTTP API server)
 *       owns the chat events that originate from HTTP routes —
 *       optimistic user_turn echo, choice resolution, server-emitted
 *       error / cancel / dismiss messages, hard-reset clears, and the
 *       SSE initial-state hydration.
 *
 * Phase 9 retired the legacy `ChatMessage`/`MessageContent` scratchpad
 * (`MessageManager` / `SessionManager` / `ContentMerger` /
 * `ChatLogToMessages`) — every method below operates directly on
 * chat.jsonl + TURN_BUFFER + the typed `MessageBroadcaster` events.
 */

import * as crypto from 'crypto';
import type {
  ChatLine,
  ChatStatusType,
  ChatChoicePresentedLine,
  ChatStatusLine,
  ChatThinkingLine,
  ChatAssistantMessageLine,
  ChatUserTurnLine,
  LogJobType,
  PendingCardSnapshot,
  TurnBufferSnapshotMap,
} from '@ant/shared';
import type { StateStorePort } from '../../../../../core/ports/stateStore';
import type { WorkspaceResolver } from '../../../../../core/config/WorkspacePathResolver';
import type { UserContext } from '../../../../../core/types/user';
import { FileSessionAdapter } from '../../../session/FileSessionAdapter';
import { MessageBroadcaster } from '../../../../../core/chat/MessageBroadcaster';
import { SessionPersistence } from './SessionPersistence';
import { getSessionKey } from '../../../../../core/chat/schema';
import {
  getChoiceResolvedNXKey,
  getChoiceResolvedChannel,
} from '../../../../../core/constants/redis';
import { logger } from '../../../../../utils/logger';

const COMPONENT = 'ChatService';

/**
 * Default jobType for synthetic / server-originated lines that do not
 * stem from a specific job (e.g. SSE-only optimistic echoes). The
 * worker overrides this when it owns the emission.
 */
const DEFAULT_JOB_TYPE: LogJobType = 'code';

export class ChatService {
  private readonly broadcaster: MessageBroadcaster;
  private readonly persistence: SessionPersistence;
  private defaultUserContext?: UserContext;

  constructor(
    _workspaceRoot: string,
    private readonly stateStore?: StateStorePort,
    private readonly workspaceResolver?: WorkspaceResolver,
  ) {
    this.broadcaster = new MessageBroadcaster(stateStore);
    this.persistence = new SessionPersistence(workspaceResolver);
  }

  // ═══════════════════════════════════════════════════════════════════
  // Lifecycle
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Bind a default user context for fire-and-forget operations that do
   * not receive one explicitly (e.g. server-shutdown drains).
   */
  setUserContext(userContext: UserContext): void {
    this.defaultUserContext = userContext;
  }

  /** Drain pending broadcaster publishes and shut down. */
  async cleanup(): Promise<void> {
    await this.broadcaster.drain().catch(() => {});
  }

  // ═══════════════════════════════════════════════════════════════════
  // user_turn — optimistic echo
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Optimistic user_turn echo.
   *
   * The durable user_turn line is written by the worker's `recordUserTurn`
   * (orchestrator entry, before the graph runs) — that's the SSOT. To
   * keep the UI snappy we also emit a `chat_event_appended` SSE event
   * here so the user's bubble appears immediately, before the worker
   * spawns. The id (`user-{turnId}`) matches the durable copy so
   * reconnect dedupes via the FE projector.
   *
   * No chat.jsonl write happens here — that would race the worker's
   * recordUserTurn and produce a duplicate line.
   */
  async appendUserTurn(
    projectId: string,
    featureName: string,
    text: string,
    turnId: string,
    jobId?: string,
    userContext?: UserContext,
    actionMetadata?: import('@ant/shared').ActionMetadata,
  ): Promise<void> {
    const ctx = userContext ?? this.defaultUserContext;
    const line: ChatUserTurnLine = {
      type: 'user_turn',
      ts: new Date().toISOString(),
      jobId: jobId ?? '',
      turnId,
      jobType: DEFAULT_JOB_TYPE,
      text,
      sourceRef: `feature.jsonl#${turnId}`,
      ...(actionMetadata && Object.keys(actionMetadata).length > 0
        ? { actionMetadata }
        : {}),
    };
    this.broadcaster.broadcastChatLine(projectId, featureName, line, ctx);
  }

  // ═══════════════════════════════════════════════════════════════════
  // assistant_message / chat_status / assistant_thinking
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Append an assistant_message line. Persists to chat.jsonl and emits
   * `chat_event_appended` SSE. Used for server-emitted text (job-error,
   * prereq failures, conflict notifications, triage guide responses).
   */
  async appendAssistantMessage(
    projectId: string,
    featureName: string,
    text: string,
    args: {
      jobId: string;
      turnId?: string | null;
      jobType?: LogJobType;
      userContext?: UserContext;
    },
  ): Promise<void> {
    if (!text) return;
    const ctx = args.userContext ?? this.defaultUserContext;
    const turnId =
      args.turnId
      ?? (await this.findTurnIdForJobWithFallback(projectId, featureName, args.jobId, ctx));
    if (!turnId) return;

    const adapter = this.makeAdapter(projectId, featureName, ctx);
    const line: ChatAssistantMessageLine = {
      type: 'assistant_message',
      ts: new Date().toISOString(),
      jobId: args.jobId,
      turnId,
      jobType: args.jobType ?? DEFAULT_JOB_TYPE,
      text,
    };

    await this.appendAndBroadcast(adapter, projectId, featureName, line, ctx);
  }

  /** Persist a chat_status line + emit `chat_event_appended` SSE. */
  async appendChatStatus(
    projectId: string,
    featureName: string,
    args: {
      jobId: string;
      turnId?: string | null;
      jobType?: LogJobType;
      cardId: string;
      statusType: ChatStatusType;
      metadata?: Record<string, unknown>;
      userContext?: UserContext;
    },
  ): Promise<void> {
    const ctx = args.userContext ?? this.defaultUserContext;
    const turnId =
      args.turnId
      ?? (await this.findTurnIdForJobWithFallback(projectId, featureName, args.jobId, ctx));
    if (!turnId) return;

    const adapter = this.makeAdapter(projectId, featureName, ctx);
    const line: ChatStatusLine = {
      type: 'chat_status',
      ts: new Date().toISOString(),
      jobId: args.jobId,
      turnId,
      jobType: args.jobType ?? DEFAULT_JOB_TYPE,
      cardId: args.cardId,
      statusType: args.statusType,
      metadata: args.metadata,
    };
    await this.appendAndBroadcast(adapter, projectId, featureName, line, ctx);
  }

  /** Persist an assistant_thinking line + emit `chat_event_appended` SSE. */
  async appendThinking(
    projectId: string,
    featureName: string,
    text: string,
    args: {
      jobId: string;
      turnId?: string | null;
      jobType?: LogJobType;
      cardId?: string;
      durationMs?: number;
      userContext?: UserContext;
    },
  ): Promise<void> {
    if (!text) return;
    const ctx = args.userContext ?? this.defaultUserContext;
    const turnId =
      args.turnId
      ?? (await this.findTurnIdForJobWithFallback(projectId, featureName, args.jobId, ctx));
    if (!turnId) return;

    const adapter = this.makeAdapter(projectId, featureName, ctx);
    const line: ChatThinkingLine = {
      type: 'assistant_thinking',
      ts: new Date().toISOString(),
      jobId: args.jobId,
      turnId,
      jobType: args.jobType ?? DEFAULT_JOB_TYPE,
      text,
      ...(typeof args.durationMs === 'number' ? { durationMs: args.durationMs } : {}),
      ...(args.cardId ? { cardId: args.cardId } : {}),
    };
    await this.appendAndBroadcast(adapter, projectId, featureName, line, ctx);
  }

  // ═══════════════════════════════════════════════════════════════════
  // choice_presented / choice_resolved
  // ═══════════════════════════════════════════════════════════════════

  /** Emit a choice_presented line + SSE. Used for triage / clarifying / eval-save / etc. */
  async appendChoicePresented(
    projectId: string,
    featureName: string,
    args: {
      jobId: string;
      turnId?: string | null;
      jobType?: LogJobType;
      cardId: string;
      cardType: string;
      prompt?: string;
      payload?: Record<string, unknown>;
      userContext?: UserContext;
    },
  ): Promise<void> {
    const ctx = args.userContext ?? this.defaultUserContext;
    const turnId =
      args.turnId
      ?? (await this.findTurnIdForJobWithFallback(projectId, featureName, args.jobId, ctx));
    if (!turnId) return;

    const adapter = this.makeAdapter(projectId, featureName, ctx);
    const line: ChatChoicePresentedLine = {
      type: 'choice_presented',
      ts: new Date().toISOString(),
      jobId: args.jobId,
      turnId,
      jobType: args.jobType ?? DEFAULT_JOB_TYPE,
      cardId: args.cardId,
      cardType: args.cardType,
      prompt: args.prompt,
      payload: args.payload,
    };
    await this.appendAndBroadcast(adapter, projectId, featureName, line, ctx);
  }

  /**
   * Emit a `choice_presented` cancelled card with chat-SSOT §8 NX
   * idempotency. Returns `{ cardId, emitted }` — `emitted=false` means
   * the per-job NX flag was already held, so a prior call already wrote
   * the card. Auto-resolves any stale unresolved cancelled cards for
   * the same feature so they don't pile up across runs.
   *
   * cardId scheme `cancelled-{turnId}-{jobId}-{pauseSeq}`:
   *   pauseSeq is a Redis-INCR sequence per turnId (chat-SSOT §7 §C.5)
   *   so consecutive pause/resume cycles for the SAME jobId mint
   *   distinct cardIds — required because the per-cardId
   *   `choice:resolved:{cardId}` NX flag has a 24h TTL. Without the
   *   sequence, cycle 2 resume would NX-miss against cycle 1's flag.
   */
  async appendChoicePresentedCancelled(
    projectId: string,
    featureName: string,
    jobId: string,
    args: {
      reason: string;
      message: string;
      jobType?: LogJobType;
      designErrorType?: string;
      userContext?: UserContext;
    },
  ): Promise<{ cardId: string; emitted: boolean }> {
    const ctx = args.userContext ?? this.defaultUserContext;
    const turnId = await this.findTurnIdForJobWithFallback(projectId, featureName, jobId, ctx);
    if (!turnId) {
      // No matching user_turn means the durable log can't anchor the
      // cancelled card. Skip emission rather than write a turnless line.
      // Surface a warning so this failure mode is visible in logs — when
      // it happens the user sees no Cancelled/Resume card after refresh.
      logger.warn(
        `appendChoicePresentedCancelled: no user_turn matches jobId=${jobId} (project=${projectId}, feature=${featureName}, reason=${args.reason}). Skipping emission.`,
        { component: COMPONENT },
      );
      return { cardId: '', emitted: false };
    }

    // chat-SSOT §8 — server-restart-proof per-job NX flag. Without this
    // a second pause source (StaleJobRecovery, BullMQ stalled handler,
    // …) could write a duplicate cancelled card.
    //
    // The NX guard's contract is "one SUCCESSFUL emit per jobId". The
    // try/finally below releases the lock when emission throws (Redis
    // blip / chat.jsonl write race / `autoResolveStaleCancelledCards`
    // failure) so the next pause source can retry. Before the
    // release-on-failure path, a partial failure between acquire and
    // append would strand the NX key for its full 24h TTL — every
    // subsequent retry against the same jobId returned `emitted=false`
    // and the user lost the Resume / Dismiss UI permanently
    // (cancelled-card-stale-NX RCA — observed on `vast-curling-perch`
    // after the cleanupJobState swallow bug, fixed in commit `8ea931b8`,
    // had already SET the key but never EMITTED the line).
    const cancelledNxKey = `ant:chat:cancelled-emitted:job:${jobId}`;
    const acquired = this.stateStore
      ? await this.stateStore.acquireLock(cancelledNxKey, 24 * 60 * 60).catch(() => true)
      : true;
    if (!acquired) {
      logger.info(
        `Cancelled-emitted NX miss for job ${jobId} — already emitted; skipping`,
        { component: COMPONENT },
      );
      return { cardId: '', emitted: false };
    }

    let emitSucceeded = false;
    try {
      // Auto-resolve any stale unresolved cancelled cards for this
      // feature. Mirrors the legacy MessageManager logic so the chat
      // view stays tidy across consecutive interruptions.
      await this.autoResolveStaleCancelledCards(projectId, featureName, jobId, ctx);

      // Mint pauseSeq via the shared StateStorePort primitive so the
      // cardId is unique per pause cycle. Falls back to Date.now() in
      // tests / local mode without a stateStore.
      const pauseSeq = this.stateStore
        ? await this.stateStore.nextPauseSeq(turnId).catch(() => Date.now())
        : Date.now();
      const cardId = `cancelled-${turnId}-${jobId}-${pauseSeq}`;
      // Synthetic per-card workerScope: each cancelled card lands in
      // its own FE section so chronological sort places it at its
      // actual ts rather than piggybacking on `_main_`'s pinned-first
      // position. See `selectTurns` + 31-chat-system.md §섹션-정렬.
      const workerScope = `_cancelled_:${cardId}`;
      const adapter = this.makeAdapter(projectId, featureName, ctx);
      const line: ChatChoicePresentedLine = {
        type: 'choice_presented',
        ts: new Date().toISOString(),
        jobId,
        turnId,
        jobType: args.jobType ?? DEFAULT_JOB_TYPE,
        workerScope,
        cardId,
        cardType: 'cancelled',
        prompt: args.message,
        payload: {
          reason: args.reason,
          jobId,
          ...(args.designErrorType ? { designErrorType: args.designErrorType } : {}),
        },
      };
      await this.appendAndBroadcast(adapter, projectId, featureName, line, ctx);
      emitSucceeded = true;
      return { cardId, emitted: true };
    } finally {
      // Release the NX guard ONLY when the line was not actually
      // emitted. The success path keeps the 24h NX held so the
      // multi-pause-source idempotency contract stays intact; the
      // failure path returns the lock to the pool so the next caller
      // can retry instead of inheriting a permanent skip.
      if (!emitSucceeded && this.stateStore) {
        await this.stateStore.releaseLock(cancelledNxKey).catch((err) =>
          logger.warn(
            `releaseLock cancelled-emitted NX failed for job ${jobId}`,
            { component: COMPONENT },
            err,
          ),
        );
      }
    }
  }

  /**
   * Server-side backstop for the cancelled-turn streaming overlay.
   *
   * Why: when a worker's child process is SIGTERM'd, the
   * `LLMResponseService.finalizeMessage(true)` path that normally
   * publishes the empty `streaming_buffer_snapshot` (see Phase 2) may
   * not finish within the 1.8s graceful-shutdown budget — leaving stale
   * `activeText`/`activeThinking`/`pendingCards` overlays in the FE's
   * Zustand mirror. The HTTP-side `cleanupJobState` runs after the
   * worker has already exited, so we sweep every active TURN_BUFFER for
   * the feature, drop the Redis keys, and broadcast empty snapshots so
   * the FE projector clears its `streamingBuffers[key]` for each
   * `(turnId, workerScope)` pair.
   *
   * Idempotent and best-effort: an already-empty buffer simply yields
   * an empty list; partial Redis or broadcast failures are logged but
   * never thrown so they cannot block the lifecycle helper that called
   * us.
   */
  async clearAllTurnBuffers(
    projectId: string,
    featureName: string,
    userContext?: UserContext,
  ): Promise<void> {
    const ctx = userContext ?? this.defaultUserContext;
    if (!ctx || !this.stateStore) return;
    const sessionKey = getSessionKey(projectId, featureName, ctx);

    let active: Awaited<ReturnType<StateStorePort['listActiveTurnBuffers']>>;
    try {
      active = await this.stateStore.listActiveTurnBuffers(sessionKey);
    } catch (err) {
      logger.warn(`clearAllTurnBuffers: listActiveTurnBuffers failed`, { component: COMPONENT }, err);
      return;
    }
    if (active.length === 0) return;

    for (const snap of active) {
      // `_main_` round-trips as `undefined` over the wire (see
      // `LLMResponseService.workerScopeForLine`), keeping the FE's
      // bufferKey scheme consistent across worker / HTTP emitters.
      const wireScope = snap.workerScope && snap.workerScope !== '_main_' ? snap.workerScope : undefined;
      try {
        await this.stateStore.clearTurnBuffer(sessionKey, snap.turnId, snap.workerScope || undefined);
      } catch (err) {
        logger.warn(
          `clearAllTurnBuffers: clearTurnBuffer failed for turnId=${snap.turnId} ws=${snap.workerScope}`,
          { component: COMPONENT },
          err,
        );
      }
      try {
        this.broadcaster.broadcastStreamingBufferSnapshot(
          projectId,
          featureName,
          {
            turnId: snap.turnId,
            workerScope: wireScope,
            text: '',
            thinking: '',
            pendingCards: {},
          },
          ctx,
        );
      } catch (err) {
        logger.warn(
          `clearAllTurnBuffers: broadcastStreamingBufferSnapshot failed for turnId=${snap.turnId}`,
          { component: COMPONENT },
          err,
        );
      }
    }
  }

  /**
   * Resolve a previously-presented choice card. Idempotent via the
   * per-cardId NX flag (chat-SSOT §7) — the second caller for the same
   * cardId no-ops. Also publishes to the choice-resolved Pub/Sub channel
   * so any worker awaiting the user's answer can resolve its promise.
   */
  async appendChoiceResolved(
    projectId: string,
    featureName: string,
    args: {
      jobId: string;
      cardId: string;
      choiceSelected: string;
      resolvedLabel: string;
      answer?: Record<string, unknown>;
      /**
       * Card-identity SSOT (Invariant I3): jobType is intentionally NOT
       * accepted from the caller. We always lookup the original
       * choice_presented line by cardId and reuse its jobType, so the
       * resolver's `selectedJobType` (which may have drifted to 'code'
       * since the card was issued — see zonal-dreaming-novel regression)
       * cannot re-label the card.
       */
      userContext?: UserContext;
    },
  ): Promise<{ resolved: boolean }> {
    if (!args.cardId) return { resolved: false };

    // chat-SSOT §7 — single-shot NX so duplicate clicks (network retry,
    // multi-pod fan-out, etc.) cannot double-emit.
    const nxKey = getChoiceResolvedNXKey(args.cardId);
    const acquired = this.stateStore
      ? await this.stateStore.acquireLock(nxKey, 24 * 60 * 60).catch(() => true)
      : true;
    if (!acquired) {
      logger.debug(
        `Choice ${args.cardId} already resolved — skipping duplicate emission`,
        { component: COMPONENT },
      );
      return { resolved: false };
    }

    const ctx = args.userContext ?? this.defaultUserContext;

    // Card-identity SSOT — read jobType from the original card. If the
    // card cannot be located the resolve event is suppressed (a missing
    // card is a structural error; we'd rather surface it via the empty
    // result than silently mint a `jobType: 'code'` line).
    const cardOrigin = await this.findTurnIdByCardId(projectId, featureName, args.cardId, ctx);
    const turnId =
      cardOrigin?.turnId ??
      (await this.findTurnIdForJobWithFallback(projectId, featureName, args.jobId, ctx));

    if (turnId) {
      // Build ONE line and route it through both sinks so the disk
      // copy and the SSE broadcast share the exact same `ts` — without
      // this, FE projector last-write-wins on cardId could pick the
      // wrong order between disk replay and live broadcast.
      const adapter = this.makeAdapter(projectId, featureName, ctx);
      const line: ChatLine = {
        type: 'choice_resolved',
        ts: new Date().toISOString(),
        jobId: cardOrigin?.jobId ?? args.jobId,
        turnId,
        jobType: cardOrigin?.jobType ?? DEFAULT_JOB_TYPE,
        // Inherit the original presented line's workerScope so the
        // resolved line lands in the same FE section as its sibling.
        // Critical for cancelled cards whose presented carries a
        // synthetic `_cancelled_:{cardId}` scope.
        ...(cardOrigin?.workerScope ? { workerScope: cardOrigin.workerScope } : {}),
        cardId: args.cardId,
        choiceSelected: args.choiceSelected,
        resolvedLabel: args.resolvedLabel,
        answer: args.answer,
      };
      await this.appendAndBroadcast(adapter, projectId, featureName, line, ctx);
    }

    // Fan out via Pub/Sub so any worker awaiting the answer (
    // sendTriageChoice / sendClarifyCards / sendChoiceCard) can resolve
    // its promise even when the click landed on a different pod than
    // the worker.
    if (this.stateStore && ctx) {
      const sessionKey = getSessionKey(projectId, featureName, ctx);
      const channel = getChoiceResolvedChannel(sessionKey);
      this.stateStore
        .publish(channel, {
          cardId: args.cardId,
          choiceSelected: args.choiceSelected,
          resolvedLabel: args.resolvedLabel,
          answer: args.answer,
        })
        .catch((err) =>
          logger.warn(
            `Failed to publish choice_resolved fanout: ${(err as Error)?.message ?? err}`,
            { component: COMPONENT },
          ),
        );
    }

    // Release the cancelled-emitted NX flag — when the user answers a
    // cancelled card (Resume / Dismiss), the next pause of the same
    // jobId should be free to emit a fresh cancelled card.
    if (this.stateStore && args.choiceSelected !== 'auto_stale') {
      const cancelledNxKey = `ant:chat:cancelled-emitted:job:${args.jobId}`;
      this.stateStore.releaseLock(cancelledNxKey).catch(() => {});
    }

    return { resolved: true };
  }

  // ═══════════════════════════════════════════════════════════════════
  // Streaming wrappers (TURN_BUFFER + streaming_delta SSE)
  //
  // Symmetric to the worker-side LLMResponseService stream methods.
  // No HTTP route currently calls these, but the surface is provided
  // for tests + future server-emitted streams (e.g. a server-to-client
  // tail that fans out an existing chat_status card's stdout).
  // ═══════════════════════════════════════════════════════════════════

  async streamThinkingChunk(
    projectId: string,
    featureName: string,
    args: { turnId: string; chunk: string; cardId?: string; workerScope?: string; userContext?: UserContext },
  ): Promise<void> {
    if (!this.stateStore || !args.chunk || !args.turnId) return;
    const ctx = args.userContext ?? this.defaultUserContext;
    const sessionKey = ctx ? getSessionKey(projectId, featureName, ctx) : null;
    if (!sessionKey) return;
    await this.stateStore
      .appendToTurnBuffer(sessionKey, args.turnId, args.workerScope, 'thinking', args.chunk)
      .catch((err) =>
        logger.warn(`appendToTurnBuffer(thinking) failed`, { component: COMPONENT }, err),
      );
    this.broadcaster.broadcastStreamingDelta(
      projectId,
      featureName,
      {
        turnId: args.turnId,
        workerScope: args.workerScope,
        kind: 'thinking',
        cardId: args.cardId,
        chunk: args.chunk,
      },
      ctx,
    );
  }

  async streamTextChunk(
    projectId: string,
    featureName: string,
    args: { turnId: string; chunk: string; workerScope?: string; userContext?: UserContext },
  ): Promise<void> {
    if (!this.stateStore || !args.chunk || !args.turnId) return;
    const ctx = args.userContext ?? this.defaultUserContext;
    const sessionKey = ctx ? getSessionKey(projectId, featureName, ctx) : null;
    if (!sessionKey) return;
    await this.stateStore
      .appendToTurnBuffer(sessionKey, args.turnId, args.workerScope, 'text', args.chunk)
      .catch((err) =>
        logger.warn(`appendToTurnBuffer(text) failed`, { component: COMPONENT }, err),
      );
    this.broadcaster.broadcastStreamingDelta(
      projectId,
      featureName,
      {
        turnId: args.turnId,
        workerScope: args.workerScope,
        kind: 'text',
        chunk: args.chunk,
      },
      ctx,
    );
  }

  async registerPendingCard(
    projectId: string,
    featureName: string,
    args: {
      turnId: string;
      cardId: string;
      statusType: ChatStatusType;
      metadata?: Record<string, unknown>;
      workerScope?: string;
      userContext?: UserContext;
    },
  ): Promise<void> {
    if (!this.stateStore || !args.turnId || !args.cardId) return;
    const ctx = args.userContext ?? this.defaultUserContext;
    const sessionKey = ctx ? getSessionKey(projectId, featureName, ctx) : null;
    if (!sessionKey) return;
    const card: PendingCardSnapshot = {
      cardId: args.cardId,
      statusType: args.statusType,
      metadata: { ...(args.metadata ?? {}) },
    };
    await this.stateStore
      .setTurnBufferPendingCard(sessionKey, args.turnId, args.workerScope, card)
      .catch((err) =>
        logger.warn(`setTurnBufferPendingCard failed`, { component: COMPONENT }, err),
      );
    this.broadcaster.broadcastStreamingDelta(
      projectId,
      featureName,
      {
        turnId: args.turnId,
        workerScope: args.workerScope,
        kind: 'card_output',
        cardId: args.cardId,
        chunk: '',
      },
      ctx,
    );
  }

  async streamCardOutput(
    projectId: string,
    featureName: string,
    args: {
      turnId: string;
      cardId: string;
      chunk: string;
      workerScope?: string;
      userContext?: UserContext;
    },
  ): Promise<void> {
    if (!this.stateStore || !args.chunk || !args.cardId || !args.turnId) return;
    const ctx = args.userContext ?? this.defaultUserContext;
    const sessionKey = ctx ? getSessionKey(projectId, featureName, ctx) : null;
    if (!sessionKey) return;
    await this.stateStore
      .appendToTurnBuffer(
        sessionKey,
        args.turnId,
        args.workerScope,
        'card_output',
        args.chunk,
        args.cardId,
      )
      .catch((err) =>
        logger.warn(`appendToTurnBuffer(card_output) failed`, { component: COMPONENT }, err),
      );
    this.broadcaster.broadcastStreamingDelta(
      projectId,
      featureName,
      {
        turnId: args.turnId,
        workerScope: args.workerScope,
        kind: 'card_output',
        cardId: args.cardId,
        chunk: args.chunk,
      },
      ctx,
    );
  }

  /**
   * Finalize a pending card — promotes it from TURN_BUFFER into a
   * chat_status line. Convenience over `appendChatStatus` +
   * `clearTurnBufferPendingCard` for the common case.
   */
  async finalizePendingCard(
    projectId: string,
    featureName: string,
    args: {
      jobId: string;
      turnId: string;
      cardId: string;
      statusType: ChatStatusType;
      metadata?: Record<string, unknown>;
      jobType?: LogJobType;
      workerScope?: string;
      userContext?: UserContext;
    },
  ): Promise<void> {
    const ctx = args.userContext ?? this.defaultUserContext;
    const sessionKey = ctx ? getSessionKey(projectId, featureName, ctx) : null;
    if (this.stateStore && sessionKey) {
      await this.stateStore
        .clearTurnBufferPendingCard(sessionKey, args.turnId, args.workerScope, args.cardId)
        .catch((err) =>
          logger.warn(`clearTurnBufferPendingCard failed`, { component: COMPONENT }, err),
        );
    }
    await this.appendChatStatus(projectId, featureName, {
      jobId: args.jobId,
      turnId: args.turnId,
      jobType: args.jobType,
      cardId: args.cardId,
      statusType: args.statusType,
      metadata: args.metadata,
      userContext: ctx,
    });
  }

  /** Drop the streaming buffer for `(turnId, workerScope?)` only. */
  async clearStreamingBuffer(
    projectId: string,
    featureName: string,
    turnId: string,
    workerScope?: string,
    userContext?: UserContext,
  ): Promise<void> {
    if (!this.stateStore) return;
    const ctx = userContext ?? this.defaultUserContext;
    const sessionKey = ctx ? getSessionKey(projectId, featureName, ctx) : null;
    if (!sessionKey) return;
    await this.stateStore
      .clearTurnBuffer(sessionKey, turnId, workerScope)
      .catch((err) =>
        logger.warn(`clearTurnBuffer failed`, { component: COMPONENT }, err),
      );
  }

  /** Drop every active turn buffer for the feature (Hard Reset path). */
  async clearAllTurnBuffersForFeature(
    projectId: string,
    featureName: string,
    userContext?: UserContext,
  ): Promise<void> {
    if (!this.stateStore) return;
    const ctx = userContext ?? this.defaultUserContext;
    const sessionKey = ctx ? getSessionKey(projectId, featureName, ctx) : null;
    if (!sessionKey) return;
    await this.stateStore
      .clearAllTurnBuffersForFeature(sessionKey)
      .catch((err) =>
        logger.warn(`clearAllTurnBuffersForFeature failed`, { component: COMPONENT }, err),
      );
  }

  // ═══════════════════════════════════════════════════════════════════
  // Reads (FE store hydration via SSE chat_initial_state)
  // ═══════════════════════════════════════════════════════════════════

  /** Load every non-collapsed chat.jsonl line for the feature. */
  async loadEventsAsync(
    projectId: string,
    featureName: string,
    userContext?: UserContext,
  ): Promise<ChatLine[]> {
    const ctx = userContext ?? this.defaultUserContext;
    const adapter = this.makeAdapter(projectId, featureName, ctx);
    if (!adapter) return [];
    try {
      return await adapter.loadAllChat();
    } catch (err) {
      logger.warn(
        `loadAllChat failed for ${projectId}/${featureName}`,
        { component: COMPONENT },
        err,
      );
      return [];
    }
  }

  /**
   * Snapshot every active turn-buffer for the feature. Used together
   * with `loadEventsAsync` to seed `chat_initial_state` on SSE open.
   */
  async loadTurnBuffersAsync(
    projectId: string,
    featureName: string,
    userContext?: UserContext,
  ): Promise<TurnBufferSnapshotMap> {
    if (!this.stateStore) return {};
    const ctx = userContext ?? this.defaultUserContext;
    if (!ctx) return {};
    const sessionKey = getSessionKey(projectId, featureName, ctx);
    try {
      const snapshots = await this.stateStore.listActiveTurnBuffers(sessionKey);
      const map: TurnBufferSnapshotMap = {};
      for (const snap of snapshots) {
        const key = `${snap.turnId}:${snap.workerScope}`;
        map[key] = snap;
      }
      return map;
    } catch (err) {
      logger.warn(
        `listActiveTurnBuffers failed for ${sessionKey}`,
        { component: COMPONENT },
        err,
      );
      return {};
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // Clear
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Chat Clear / Hard Reset.
   *
   * - `scope='chat'` (default): collapse chat.jsonl in-place + clear
   *   every active turn buffer + emit `events_cleared` SSE. Preserves
   *   feature.jsonl (LLM context SSOT).
   * - `scope='full'`: same Redis cleanup; the caller (HardReset route)
   *   physically unlinks the session files separately. Disk collapse
   *   intentionally skipped here.
   */
  async clearEventsAsync(
    projectId: string,
    featureName: string,
    scope: 'chat' | 'full' = 'chat',
    userContext?: UserContext,
  ): Promise<void> {
    const ctx = userContext ?? this.defaultUserContext;

    if (scope === 'chat') {
      await this.persistence.collapseChatLogOnly(projectId, featureName, ctx);
    }

    await this.clearAllTurnBuffersForFeature(projectId, featureName, ctx);

    this.broadcaster.broadcastEventsCleared(projectId, featureName, scope, ctx);
  }

  // ═══════════════════════════════════════════════════════════════════
  // Context lookup
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Resolve the turnId associated with a jobId via feature.jsonl, with
   * chat.jsonl fallback for ask/inline-ask jobType (which write
   * user_turn ONLY to chat.jsonl with `skipFeature: true`).
   */
  async findTurnIdForJob(
    projectId: string,
    featureName: string,
    jobId: string,
    userContext?: UserContext,
  ): Promise<string | null> {
    const ctx = userContext ?? this.defaultUserContext;
    return this.findTurnIdForJobWithFallback(projectId, featureName, jobId, ctx);
  }

  /**
   * Internal — feature.jsonl first (code/design/plan jobType), chat.jsonl
   * fallback (ask/inline-ask jobType where the feature.jsonl side is
   * intentionally skipped per session-redesign §4.5).
   */
  private async findTurnIdForJobWithFallback(
    projectId: string,
    featureName: string,
    jobId: string,
    userContext: UserContext | undefined,
  ): Promise<string | null> {
    const fromFeature = await this.persistence.findTurnIdForJob(
      projectId,
      featureName,
      jobId,
      userContext,
    );
    if (fromFeature) return fromFeature;

    // Chat-only fallback. Reads chat.jsonl directly because ask /
    // inline-ask jobs do not surface in feature.jsonl.
    const adapter = this.makeAdapter(projectId, featureName, userContext);
    if (!adapter) return null;
    try {
      const lines = await adapter.loadAllChat();
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i];
        if (line.collapsed) continue;
        if (line.type === 'user_turn' && line.jobId === jobId) return line.turnId;
      }
    } catch (err) {
      logger.warn(
        `findTurnIdForJob chat.jsonl fallback failed for ${projectId}/${featureName}`,
        { component: COMPONENT },
        err,
      );
    }
    return null;
  }

  /**
   * Resolve every unresolved cancelled card (`cardType='cancelled'`)
   * for the given jobId by emitting a `choice_resolved` line for each.
   * Used by `/jobs/:id/resume` and `/jobs/:id/continue` — the user
   * chose to keep working on the job, so all of its open cancelled
   * cards should flip to "Resumed" in the chat view.
   *
   * Returns the number of cards resolved. Each resolution flows through
   * `appendChoiceResolved` so the per-cardId NX flag, choice-resolved
   * Pub/Sub fanout, and the `cancelled-emitted:job:{jobId}` lock
   * release all run for free.
   */
  async resolveAllCancelledForJob(
    projectId: string,
    featureName: string,
    jobId: string,
    args: {
      choiceSelected?: string;
      resolvedLabel?: string;
      userContext?: UserContext;
    } = {},
  ): Promise<number> {
    const ctx = args.userContext ?? this.defaultUserContext;
    const adapter = this.makeAdapter(projectId, featureName, ctx);
    if (!adapter) return 0;

    let lines: ChatLine[];
    try {
      lines = await adapter.loadAllChat();
    } catch (err) {
      logger.warn(
        `resolveAllCancelledForJob: loadAllChat failed`,
        { component: COMPONENT },
        err,
      );
      return 0;
    }

    // cardId → resolved? scan once.
    const resolvedIds = new Set<string>();
    for (const line of lines) {
      if (line.collapsed) continue;
      if (line.type === 'choice_resolved') resolvedIds.add(line.cardId);
    }

    const targets: string[] = [];
    for (const line of lines) {
      if (line.collapsed) continue;
      if (line.type !== 'choice_presented') continue;
      const presented = line as ChatChoicePresentedLine;
      if (presented.cardType !== 'cancelled') continue;
      if (presented.jobId !== jobId) continue;
      if (resolvedIds.has(presented.cardId)) continue;
      targets.push(presented.cardId);
    }

    let resolvedCount = 0;
    for (const cardId of targets) {
      // jobType is intentionally not forwarded — appendChoiceResolved
      // looks up the original choice_presented line via cardId so the
      // resolve event carries the card-bound jobType (Invariant I3).
      const result = await this.appendChoiceResolved(projectId, featureName, {
        jobId,
        cardId,
        choiceSelected: args.choiceSelected ?? 'resume',
        resolvedLabel: args.resolvedLabel ?? 'Resumed',
        userContext: ctx,
      });
      if (result.resolved) resolvedCount++;
    }

    if (resolvedCount > 0) {
      logger.info(
        `Resolved ${resolvedCount} cancelled card(s) for job ${jobId}`,
        { component: COMPONENT },
      );
    }
    return resolvedCount;
  }

  /**
   * Resolve the turnId of the chat.jsonl line that originally presented
   * `cardId`. Used by `/chat/choice-resolved` when the body carries
   * `cardId` but no `jobId` (e.g. cancelled cards minted from outside
   * the worker process).
   */
  async findTurnIdByCardId(
    projectId: string,
    featureName: string,
    cardId: string,
    userContext?: UserContext,
  ): Promise<{
    turnId: string;
    jobId: string;
    jobType: LogJobType;
    workerScope?: string;
  } | null> {
    const ctx = userContext ?? this.defaultUserContext;
    const adapter = this.makeAdapter(projectId, featureName, ctx);
    if (!adapter) return null;
    try {
      const lines = await adapter.loadAllChat();
      for (const line of lines) {
        if (line.collapsed) continue;
        if (line.type !== 'choice_presented') continue;
        if ((line as ChatChoicePresentedLine).cardId === cardId) {
          // Card-identity SSOT (Invariant I3): the resolve event MUST
          // carry the same jobType as the original choice_presented line.
          // We surface jobType here so callers (route handler /
          // appendChoiceResolved) can never re-label a card with the
          // resolver's `selectedJobType`.
          //
          // workerScope is also surfaced so cancelled-card resolves
          // land in the SAME synthetic FE section as their presented
          // sibling (chronological placement, see selectTurns).
          return {
            turnId: line.turnId,
            jobId: line.jobId,
            jobType: line.jobType,
            workerScope: line.workerScope,
          };
        }
      }
    } catch (err) {
      logger.warn(
        `findTurnIdByCardId failed for ${projectId}/${featureName}`,
        { component: COMPONENT },
        err,
      );
    }
    return null;
  }

  // ═══════════════════════════════════════════════════════════════════
  // Internals
  // ═══════════════════════════════════════════════════════════════════

  private makeAdapter(
    projectId: string,
    featureName: string,
    userContext?: UserContext,
  ): FileSessionAdapter | null {
    if (!this.workspaceResolver || !userContext) return null;
    let featurePath: string | null = null;
    try {
      featurePath = this.workspaceResolver.getFeaturePath(userContext, projectId, featureName);
    } catch {
      return null;
    }
    if (!featurePath) return null;
    return new FileSessionAdapter(featurePath, 'architect', projectId, featureName);
  }

  private async appendAndBroadcast(
    adapter: FileSessionAdapter | null,
    projectId: string,
    featureName: string,
    line: ChatLine,
    userContext: UserContext | undefined,
  ): Promise<void> {
    if (adapter) {
      await adapter.appendLine('chat', line).catch((err) =>
        logger.warn(
          `appendLine(${line.type}) failed: ${(err as Error)?.message ?? err}`,
          { component: COMPONENT },
        ),
      );
    }
    this.broadcaster.broadcastChatLine(projectId, featureName, line, userContext);
  }

  /**
   * Auto-resolve every unresolved cancelled card across the feature
   * before emitting a fresh one. Mirrors the legacy MessageManager
   * behaviour (chat-SSOT §8) so the chat view does not accumulate
   * orphaned choice cards.
   */
  private async autoResolveStaleCancelledCards(
    projectId: string,
    featureName: string,
    excludeJobId: string,
    userContext: UserContext | undefined,
  ): Promise<void> {
    const adapter = this.makeAdapter(projectId, featureName, userContext);
    if (!adapter) return;

    let lines: ChatLine[];
    try {
      lines = await adapter.loadAllChat();
    } catch (err) {
      logger.warn(
        `autoResolveStaleCancelledCards: loadAllChat failed`,
        { component: COMPONENT },
        err,
      );
      return;
    }

    const resolvedIds = new Set<string>();
    for (const line of lines) {
      if (line.collapsed) continue;
      if (line.type === 'choice_resolved') resolvedIds.add(line.cardId);
    }

    const stale: Array<{
      cardId: string;
      jobId: string;
      turnId: string;
      jobType: LogJobType;
      workerScope?: string;
    }> = [];
    for (const line of lines) {
      if (line.collapsed) continue;
      if (line.type !== 'choice_presented') continue;
      const presented = line as ChatChoicePresentedLine;
      if (presented.cardType !== 'cancelled') continue;
      if (resolvedIds.has(presented.cardId)) continue;
      if (presented.jobId === excludeJobId) continue;
      stale.push({
        cardId: presented.cardId,
        jobId: presented.jobId,
        turnId: presented.turnId,
        jobType: presented.jobType,
        workerScope: presented.workerScope,
      });
    }

    for (const entry of stale) {
      // Single line, single ts — routed through both sinks via the
      // shared `appendAndBroadcast` helper.
      const adapter = this.makeAdapter(projectId, featureName, userContext);
      const resolvedLine: ChatLine = {
        type: 'choice_resolved',
        ts: new Date().toISOString(),
        jobId: entry.jobId,
        turnId: entry.turnId,
        jobType: entry.jobType,
        // Preserve presented↔resolved scope pairing so the synthetic
        // resolved lands in the same FE section as the cancelled
        // presented (otherwise the cancelled card would render
        // unresolved while a phantom resolved appears in `_main_`).
        ...(entry.workerScope ? { workerScope: entry.workerScope } : {}),
        cardId: entry.cardId,
        choiceSelected: 'auto_stale',
        resolvedLabel: 'Superseded',
      };
      await this.appendAndBroadcast(adapter, projectId, featureName, resolvedLine, userContext);
    }

    if (stale.length > 0) {
      logger.info(
        `Auto-resolved ${stale.length} stale cancelled card(s) before new emission`,
        { component: COMPONENT },
      );
    }
  }
}

/**
 * Export a small helper for callers that need to mint a unique cardId
 * in the same scheme as ChatService internals.
 */
export function mintCardId(prefix = 'card'): string {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
}

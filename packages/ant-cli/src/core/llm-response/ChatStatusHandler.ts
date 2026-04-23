/**
 * ChatStatusHandler — single entry point for every chat card.
 *
 * Chat SSOT contract (see "chat SSOT fragmentation purge" plan):
 *  1. Live path: every chat card (read / list / search / file_* /
 *     command_* / mkdir / generic tool / choice card / …) is emitted by
 *     calling `showChatStatus(type, metadata)`.
 *  2. `showChatStatus` calls `generateChatStatusContent(type, metadata)`
 *     to produce the card body string, hands the resulting `MessageContent`
 *     to `ContentMerger` for live SSE broadcast, AND appends a single
 *     `chat_status` line to `chat.jsonl` via `appender.appendChatStatus`.
 *  3. Replay path reads `chat_status` lines and feeds `(statusType,
 *     metadata)` back through `generateChatStatusContent` — the same
 *     function the live path used — so the restored `MessageContent` is
 *     byte-identical to the broadcast copy.
 *
 * Result: no "replay-side builder" exists, the chat log content IS the
 * chat, and new card kinds require a single edit in
 * `generateChatStatusContent`.
 */

import type { SessionStore } from './SessionStore';
import type { ContentMerger } from '../chat/ContentMerger';
import type { MessageContent } from '../chat/types';
import type { ChatStatusType } from './types';
import { logger } from '../../utils/logger';
import { getChatLogAppender } from './chatLogAppenderRegistry';
import { generateChatStatusContent } from './generateStatusContent';
import * as crypto from 'crypto';

/**
 * Chat status emissions that do NOT produce a persisted `chat_status`
 * line.
 *
 * Two classes of entries:
 *
 * 1. Structurally transient cards — carry no semantic content.
 *    - `placeholder`: live-only shimmer injected when an assistant message
 *      starts; replaced by the first real card.
 *    - `thinking`: streamed token-by-token by `LLMEventHandler`; the final
 *      collapsed block is persisted separately via
 *      `appender.appendThinking(finalText)`.
 *
 * 2. In-progress / chunk cards that pair with a terminal card.
 *    The live path's `ContentMerger` merges these into a single slot
 *    (either via `tryFallbackMerge` for "~ing → ~ed" pairs, via
 *    explicit `_mergeIndex` for list/read-source, or via
 *    `canAppendContent` for plan-chunk append). `ChatLogToMessages`
 *    has no merge pass, so persisting every in-progress / chunk line
 *    would make replay render N cards where live renders 1. Keeping
 *    them live-only matches the shape already enforced by
 *    `FileOperationHandler` (only terminal `file_create` / `file_edit`
 *    / `file_delete` are persisted).
 *
 *    Every paired terminal card (`read`, `learned`, `listed_files`,
 *    `plan`, `explored`, …) IS persisted and carries the final
 *    metadata the UI needs, so replay reproduces the merged state
 *    byte-identically from a single line.
 */
const LIVE_ONLY_STATUS_TYPES: ReadonlySet<ChatStatusType> = new Set([
  // (1) transient
  'placeholder',
  'thinking',
  // (2) in-progress halves of "~ing / ~ed" pairs
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
  // Note: `command_running` / `command_streaming` are emitted by
  // `CommandExecutionHandler` directly through `ContentMerger.addContent`
  // and never reach this gate; only the terminal `command` line is
  // persisted there. They are therefore intentionally absent from this
  // set — they are not members of `ChatStatusType`.
  //
  // plan chunk append — the final `plan` line carries the accumulated
  // `metadata.content` so replay reproduces the full card.
  'plan_generating',
]);

export class ChatStatusHandler {
  /**
   * Live SSE broadcast is the responsibility of `ContentMerger.addContent`,
   * which calls `broadcaster.broadcastContentAdd/Update` internally. This
   * class therefore never touches `MessageBroadcaster` directly —
   * `sessionStore` + `contentMerger` are the only dependencies.
   */
  constructor(
    private sessionStore: SessionStore,
    private contentMerger: ContentMerger,
  ) {}

  /**
   * Show chat status message — the single entry point for every chat card.
   *
   * Side effects, in order:
   *   1. Build the `MessageContent` via `generateChatStatusContent`.
   *   2. Hand it to `ContentMerger` (live SSE broadcast + merge).
   *   3. Persist the card to `chat.jsonl`, branching by card class:
   *      - Choice cards (`triage_choice` / `choice_card`) → emit a
   *        `choice_presented` line carrying `cardId`. A later
   *        `choice_resolved` line is paired via `cardId` to flip the
   *        buttons to a resolved label on replay.
   *      - Every other non-live-only card → emit a `chat_status` line
   *        with `(statusType, metadata)`; replay feeds the same pair
   *        back through `generateChatStatusContent` to rebuild the
   *        identical MessageContent.
   *   4. Live-only types (`placeholder`, `thinking`) skip persistence:
   *      placeholder is a transient shimmer, thinking is persisted as a
   *      single collapsed `assistant_thinking` line by LLMEventHandler
   *      when the block closes.
   *
   * Returns the content index (the position inside the current assistant
   * message's `contents` array), or `-1` when no message is active.
   */
  showChatStatus(type: ChatStatusType, metadata?: Record<string, any>): number {
    const session = this.sessionStore.getSession();
    const ctx = this.sessionStore.getContext();

    if (!session || !session.currentMessage) {
      logger.warn(`No active message for chat status`, {
        component: 'ChatStatusHandler',
        projectId: ctx.projectId,
        featureName: ctx.featureName
      });
      return -1;
    }

    const content = this.generateStatusContent(type, metadata);

    // Durable mirror preparation: for interactive card types, mint a
    // stable cardId BEFORE we build the message content so that
    //   (a) the SSE broadcast carries it,
    //   (b) the later choice_resolved chat log line can reference the same id.
    const isChoiceCard = type === 'triage_choice' || type === 'choice_card';
    const appender = getChatLogAppender();
    const mergedMetadata: Record<string, any> = {
      provider: 'system',
      timestamp: new Date().toISOString(),
      ...metadata,
    };
    if (isChoiceCard && appender) {
      mergedMetadata.cardId =
        (metadata && typeof metadata.cardId === 'string' && metadata.cardId) ||
        `card-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    }

    const messageContent: MessageContent = {
      // `ChatStatusType` is the canonical on-disk identifier and is a
      // structural superset of `MessageContent.type` (adds
      // `processing` / `downloading` / `figma_calling` / … that the UI
      // renders through generic card components). The cast documents the
      // widening — not a semantic change.
      type: type as MessageContent['type'],
      content,
      metadata: mergedMetadata as MessageContent['metadata'],
    };

    const contentIndex = this.contentMerger.addContent(
      ctx.projectId,
      ctx.featureName,
      session,
      messageContent
    );

    this.sessionStore.updateCurrentMessage().catch(err => {
      logger.warn(`Failed to update current message in Redis`, {
        component: 'ChatStatusHandler'
      }, err);
    });

    // Durable SSOT mirror — chat.jsonl. Two disjoint branches:
    //
    //  (a) Choice cards (`triage_choice` / `choice_card`) emit a
    //      `choice_presented` line only. Its `cardId` lets a later
    //      `choice_resolved` line overlay the resolved label when the
    //      user answers (Dismiss / Resume / …). A chat_status line
    //      would render a second duplicate card on replay because
    //      choice_presented already rebuilds the card itself.
    //
    //  (b) Every other non-live-only card emits a `chat_status` line
    //      carrying `(statusType, metadata)`; replay feeds that pair
    //      back through `generateChatStatusContent` to rebuild the
    //      identical MessageContent.
    if (!appender || LIVE_ONLY_STATUS_TYPES.has(type)) {
      return contentIndex;
    }
    if (isChoiceCard && mergedMetadata.cardId) {
      const cardType = type === 'triage_choice'
        ? 'triage_choice'
        : (mergedMetadata.cardType as string | undefined) ?? 'choice_card';
      const { message: promptText, cardId: _cardId, provider: _provider, timestamp: _timestamp, ...restPayload } = mergedMetadata;
      appender.appendChoicePresented(mergedMetadata.cardId, cardType, {
        prompt: content,
        payload: { ...restPayload, message: promptText },
      });
    } else {
      // Strip purely-presentational fields that the replay reader
      // re-derives or never consumes.
      const { provider: _provider, timestamp: _timestamp, ...persistedMetadata } = mergedMetadata;
      appender.appendChatStatus(type, persistedMetadata);
    }

    return contentIndex;
  }

  /**
   * Remove a chat status UI element by its content index.
   * Used when a progress indicator (e.g. retrieving) finishes with 0 results.
   */
  removeChatStatus(contentIndex: number, expectedType?: string): void {
    const session = this.sessionStore.getSession();
    const ctx = this.sessionStore.getContext();

    if (!session || !session.currentMessage) return;

    this.contentMerger.removeContent(
      ctx.projectId,
      ctx.featureName,
      session,
      contentIndex,
      expectedType
    );

    this.sessionStore.updateCurrentMessage().catch(err => {
      logger.warn(`Failed to update current message in Redis after remove`, {
        component: 'ChatStatusHandler'
      }, err);
    });
  }

  addExploringStatus(current: number, total: number): number {
    return this.showChatStatus('exploring', { filesCount: current, totalFiles: total });
  }

  addExploredResult(filesCount: number, filesList?: string[]): number {
    return this.showChatStatus('explored', { filesCount, filesList });
  }

  addReadingFile(filePath: string): number {
    return this.showChatStatus('reading', { filePath });
  }

  addReadComplete(filePath: string, error?: string): number {
    return this.showChatStatus('read', { filePath, error });
  }

  /**
   * Generate status content text based on type.
   *
   * Thin delegation to the module-level {@link generateChatStatusContent}
   * so replay readers (`chat.jsonl` → ChatMessage[]) can call the exact
   * same function without instantiating a `ChatStatusHandler` (which
   * requires a live `SessionStore` / broadcaster).
   */
  private generateStatusContent(type: ChatStatusType, metadata?: Record<string, any>): string {
    return generateChatStatusContent(type, metadata);
  }
}

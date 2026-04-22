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
import type { MessageBroadcaster } from '../chat/MessageBroadcaster';
import type { ContentMerger } from '../chat/ContentMerger';
import type { MessageContent } from '../chat/types';
import type { ChatStatusType } from './types';
import { logger } from '../../utils/logger';
import { getTraceAppender } from './traceAppenderRegistry';
import { generateChatStatusContent } from './generateStatusContent';
import * as crypto from 'crypto';

/**
 * Chat status emissions that do NOT produce a persisted `chat_status`
 * line.
 *
 * - `placeholder` is a live-only shimmer card injected when an assistant
 *   message starts; it carries no semantic content and is replaced as
 *   soon as the first real card arrives.
 * - `thinking` is streamed token-by-token by `LLMEventHandler`; the final
 *   collapsed block is persisted separately via
 *   `appender.appendThinking(finalText)`. Persisting every chunk here
 *   would duplicate the block.
 *
 * Every other `ChatStatusType` emits exactly one `chat_status` line so
 * replay can reproduce the identical MessageContent.
 */
const LIVE_ONLY_STATUS_TYPES: ReadonlySet<ChatStatusType> = new Set([
  'placeholder',
  'thinking',
]);

export class ChatStatusHandler {
  constructor(
    private sessionStore: SessionStore,
    private contentMerger: ContentMerger,
    private broadcaster: MessageBroadcaster
  ) {}

  /**
   * Show chat status message — the single entry point for every chat card.
   *
   * Side effects, in order:
   *   1. Build the `MessageContent` via `generateChatStatusContent`.
   *   2. Hand it to `ContentMerger` (live SSE broadcast + merge).
   *   3. Append a `chat_status` line to `chat.jsonl` (durable SSOT).
   *   4. For choice cards, also emit the legacy `choice_presented` line
   *      during the migration so existing `choice_resolved` pairing logic
   *      keeps working until readers switch to `chat_status`-only.
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
    const appender = getTraceAppender();
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
      type,
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

    // Durable SSOT mirror — chat.jsonl. Every non-live-only status emits a
    // single `chat_status` line carrying `(statusType, metadata)`; replay
    // feeds that pair back through `generateChatStatusContent` to rebuild
    // the identical MessageContent.
    if (appender && !LIVE_ONLY_STATUS_TYPES.has(type)) {
      // Strip purely-presentational fields that the replay reader
      // re-derives or never consumes.
      const { provider: _provider, timestamp: _timestamp, ...persistedMetadata } = mergedMetadata;
      appender.appendChatStatus(type, persistedMetadata);
    }

    // Backward-compat legacy mirror: keep emitting `choice_presented` for
    // choice cards during the migration so existing `choice_resolved`
    // wiring (paired via cardId) continues to work until the replay
    // reader is switched to the chat_status-only path.
    if (isChoiceCard && appender && mergedMetadata.cardId) {
      const cardType = type === 'triage_choice'
        ? 'triage_choice'
        : (mergedMetadata.cardType as string | undefined) ?? 'choice_card';
      const { message: promptText, cardId: _cardId, ...restPayload } = mergedMetadata;
      appender.appendChoicePresented(mergedMetadata.cardId, cardType, {
        prompt: content,
        payload: { ...restPayload, message: promptText },
      });
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

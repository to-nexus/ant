/**
 * ChatLogAppender — fire-and-forget chat.jsonl writer.
 *
 * `chat.jsonl` is the UI rendering SSOT for chat history. Every line it
 * holds is one of the `ChatLine` shapes declared in
 * `@ant/shared/session-log.ts`:
 *
 * - `user_turn`                    — mirrored from feature.jsonl
 * - `assistant_thinking`           — the LLM's reasoning block (collapsed)
 * - `assistant_message`            — the LLM's user-visible text output
 * - `chat_status`                  — **SSOT** for every non-structural card
 *                                    (read / list / search / file_* /
 *                                    command_* / mkdir / generic tool / …)
 * - `choice_presented`             — stateful card with buttons (cancelled,
 *                                    triage_choice, eval_save, …)
 * - `choice_resolved`              — user's answer to a previously-presented
 *                                    card; paired with `cardId`
 *
 * Canonical emission path:
 *   `ChatStatusHandler.showChatStatus(type, metadata)` →
 *     `appendChatStatus(statusType, metadata)` → `chat.jsonl`
 *
 * Replay then feeds the persisted `(statusType, metadata)` pair back
 * through `generateChatStatusContent` to reproduce the same
 * MessageContent the live path broadcast — there is no "replay-side
 * builder".
 *
 * Fire-and-forget: all writes swallow errors through a warn log. The
 * chat rendering path must never block LLM streaming or tool execution.
 *
 * No-op safety: if `turnId` is not set (orchestrator hasn't recorded a
 * user_turn yet, or the appender was constructed with incomplete env),
 * every method returns silently. This preserves existing behaviour for
 * jobs that run without a turn context (tests, internal resumes, etc.).
 */

import type {
  LogJobType,
  ChatLine,
  ChatStatusType,
  ChatStatusLine,
  ChatThinkingLine,
  ChatAssistantMessageLine,
  ChatChoicePresentedLine,
  ChatChoiceResolvedLine,
} from '@ant/shared';
import { FileSessionAdapter } from '../../periphery/adapters/session/FileSessionAdapter';
import { logger } from '../../utils/logger';

export interface ChatLogAppenderConfig {
  featurePath: string;
  jobId: string;
  jobType: LogJobType;
  agent?: string;
  projectId?: string;
  featureName?: string;
}

export class ChatLogAppender {
  private readonly session: FileSessionAdapter;
  private turnId: string | null = null;

  constructor(private readonly cfg: ChatLogAppenderConfig, session?: FileSessionAdapter) {
    this.session =
      session ??
      new FileSessionAdapter(
        cfg.featurePath,
        cfg.agent ?? 'architect',
        cfg.projectId,
        cfg.featureName,
      );
  }

  setTurnId(id: string | null): void {
    this.turnId = id || null;
  }

  getTurnId(): string | null {
    return this.turnId;
  }

  isReady(): boolean {
    return Boolean(this.turnId && this.cfg.jobId && this.cfg.featurePath);
  }

  appendThinking(text: string, cardId?: string): void {
    if (!text || !this.turnId) return;
    const line: ChatThinkingLine = {
      ...this.base(),
      type: 'assistant_thinking',
      text,
      ...(cardId ? { cardId } : {}),
    };
    this.safeAppend(line);
  }

  /**
   * Persist a chat status card — the canonical on-disk shape for every
   * non-structural chat card (read / list / search / file_* / command_*
   * / mkdir / generic tool / …). `cardId` is required so that the
   * projector can fold progressive state transitions for the same card
   * (e.g. `command_running` → `command` with exitCode) via last-write-wins.
   */
  appendChatStatus(
    cardId: string,
    statusType: ChatStatusType,
    metadata?: Record<string, unknown>,
  ): void {
    if (!statusType || !cardId || !this.turnId) return;
    const line: ChatStatusLine = {
      ...this.base(),
      type: 'chat_status',
      cardId,
      statusType,
      metadata,
    };
    this.safeAppend(line);
  }

  appendAssistantMessage(text: string): void {
    if (!text || !this.turnId) return;
    const line: ChatAssistantMessageLine = {
      ...this.base(),
      type: 'assistant_message',
      text,
    };
    this.safeAppend(line);
  }

  appendChoicePresented(
    cardId: string,
    cardType: string,
    options: { prompt?: string; payload?: Record<string, unknown> } = {},
  ): void {
    if (!cardId || !this.turnId) return;
    const line: ChatChoicePresentedLine = {
      ...this.base(),
      type: 'choice_presented',
      cardId,
      cardType,
      prompt: options.prompt,
      payload: options.payload,
    };
    this.safeAppend(line);
  }

  appendChoiceResolved(
    cardId: string,
    choiceSelected: string,
    resolvedLabel: string,
    answer?: Record<string, unknown>,
  ): void {
    if (!cardId || !this.turnId) return;
    const line: ChatChoiceResolvedLine = {
      ...this.base(),
      type: 'choice_resolved',
      cardId,
      choiceSelected,
      resolvedLabel,
      answer,
    };
    this.safeAppend(line);
  }

  /**
   * Append a fully-constructed ChatLine. Used by `LLMResponseService` after
   * §5 chat-SSOT rewrite — the service builds the line shape locally so
   * the same payload can be both persisted (via this method) AND emitted
   * via `MessageBroadcaster.broadcastChatLine` without duplicating the
   * construction logic.
   *
   * Skips silently when `turnId` is unset to mirror the existing typed
   * method semantics.
   */
  appendChatLine(line: ChatLine): void {
    if (!this.turnId) return;
    this.safeAppend(line as Parameters<ChatLogAppender['safeAppend']>[0]);
  }

  private base() {
    return {
      ts: new Date().toISOString(),
      jobId: this.cfg.jobId,
      turnId: this.turnId as string,
      jobType: this.cfg.jobType,
    } as const;
  }

  private safeAppend(line: ChatLine): void {
    this.session.appendLine('chat', line).catch((err) => {
      logger.warn(
        `[ChatLog] appendLine(${line.type}) failed: ${(err as Error)?.message ?? err}`,
        { component: 'ChatLogAppender' },
      );
    });
  }
}

/**
 * TraceAppender — fire-and-forget chat.jsonl writer
 *
 * Session redesign §2.4 / §16.2 (updated by "chat SSOT fragmentation purge"):
 * chat.jsonl is the UI rendering SSOT for chat history. The historical name
 * was `trace.jsonl`; the writer keeps the `TraceAppender` class name during
 * the migration (to avoid a flag-day rename) but every new line it emits
 * lives in `chat.jsonl`.
 *
 * Canonical emission path:
 *   `ChatStatusHandler.showChatStatus(type, metadata)` →
 *     `appendChatStatus(statusType, metadata)` →
 *     `chat_status` line in `chat.jsonl`
 *
 * Every replay then feeds the persisted `(statusType, metadata)` pair back
 * into `generateStatusContent` to rebuild the identical `MessageContent`
 * — there is no "replay-side builder".
 *
 * The legacy per-event emitters (`appendToolCall` / `appendFileWrite` /
 * `appendRunCommand` / `appendJobStatus`) are retained for one migration
 * step while callers switch to `showChatStatus`; they will be removed in a
 * follow-up commit.
 *
 * Fire-and-forget: all writes swallow errors through a warn log. The chat
 * rendering path must never block LLM streaming or tool execution.
 *
 * No-op safety: if `turnId` is not set (orchestrator hasn't recorded a
 * user_turn yet, or the appender was constructed with incomplete env), every
 * method returns silently. This preserves existing behaviour for jobs that
 * run without a turn context (tests, internal resumes, etc.).
 */

import type {
  LogJobType,
  ChatStatusType,
  ChatStatusLine,
  TraceThinkingLine,
  TraceToolCallLine,
  TraceRunCommandLine,
  TraceAssistantMessageLine,
  TraceJobStatusLine,
  TraceChoicePresentedLine,
  TraceChoiceResolvedLine,
  TraceFileWriteLine,
} from '@ant/shared';
import { FileSessionAdapter } from '../../periphery/adapters/session/FileSessionAdapter';
import { logger } from '../../utils/logger';

export interface TraceAppenderConfig {
  featurePath: string;
  jobId: string;
  jobType: LogJobType;
  agent?: string;
  projectId?: string;
  featureName?: string;
}

export class TraceAppender {
  private readonly session: FileSessionAdapter;
  private turnId: string | null = null;

  constructor(private readonly cfg: TraceAppenderConfig, session?: FileSessionAdapter) {
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

  appendThinking(text: string): void {
    if (!text || !this.turnId) return;
    const line: TraceThinkingLine = {
      ...this.base(),
      type: 'assistant_thinking',
      text,
    };
    this.safeAppend(line);
  }

  /**
   * Persist a chat status card — the canonical on-disk shape for every
   * non-structural chat card (read / list / search / file_* / command_* /
   * mkdir / generic tool / choice cards / ...). Called by
   * {@link ChatStatusHandler#showChatStatus} immediately after the matching
   * `MessageContent` is built, so that replay can feed `(statusType,
   * metadata)` back through `generateStatusContent` to reproduce the same
   * card content byte-for-byte.
   */
  appendChatStatus(
    statusType: ChatStatusType,
    metadata?: Record<string, unknown>,
  ): void {
    if (!statusType || !this.turnId) return;
    const line: ChatStatusLine = {
      ...this.base(),
      type: 'chat_status',
      statusType,
      metadata,
    };
    this.safeAppend(line);
  }

  appendToolCall(
    tool: string,
    options: { args?: unknown; result?: unknown; error?: string } = {},
  ): void {
    if (!tool || !this.turnId) return;
    const line: TraceToolCallLine = {
      ...this.base(),
      type: 'tool_call',
      tool,
      args: options.args,
      result: options.result,
      error: options.error,
    };
    this.safeAppend(line);
  }

  appendRunCommand(
    cmd: string,
    options: { stdout?: string; stderr?: string; exitCode?: number } = {},
  ): void {
    if (!cmd || !this.turnId) return;
    const line: TraceRunCommandLine = {
      ...this.base(),
      type: 'run_command',
      cmd,
      stdout: options.stdout,
      stderr: options.stderr,
      exitCode: options.exitCode,
    };
    this.safeAppend(line);
  }

  /**
   * Emit a `file_write` trace line mirroring a ChatAPI file-op completion.
   *
   * Callers pass the same payload they gave to `FileOperationHandler`:
   * - `operation='create'` → `{ content }` (or `{ error }` on failure)
   * - `operation='update'` → `{ diffBefore, diffAfter }` (or `{ error }`)
   * - `operation='delete'` → `{ content? }`
   *
   * Fire-and-forget. Trace writes must never block chat streaming.
   */
  appendFileWrite(
    operation: 'create' | 'update' | 'delete',
    filePath: string,
    payload: {
      content?: string;
      diffBefore?: string;
      diffAfter?: string;
      error?: string;
    } = {},
  ): void {
    if (!filePath || !this.turnId) return;
    const line: TraceFileWriteLine = {
      ...this.base(),
      type: 'file_write',
      path: filePath,
      operation,
      content: payload.content,
      diffBefore: payload.diffBefore,
      diffAfter: payload.diffAfter,
      error: payload.error,
    };
    this.safeAppend(line);
  }

  appendAssistantMessage(text: string): void {
    if (!text || !this.turnId) return;
    const line: TraceAssistantMessageLine = {
      ...this.base(),
      type: 'assistant_message',
      text,
    };
    this.safeAppend(line);
  }

  appendJobStatus(phase: string, message?: string, progress?: number): void {
    if (!phase || !this.turnId) return;
    const line: TraceJobStatusLine = {
      ...this.base(),
      type: 'job_status',
      phase,
      message,
      progress,
    };
    this.safeAppend(line);
  }

  appendChoicePresented(
    cardId: string,
    cardType: string,
    options: { prompt?: string; payload?: Record<string, unknown> } = {},
  ): void {
    if (!cardId || !this.turnId) return;
    const line: TraceChoicePresentedLine = {
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
    const line: TraceChoiceResolvedLine = {
      ...this.base(),
      type: 'choice_resolved',
      cardId,
      choiceSelected,
      resolvedLabel,
      answer,
    };
    this.safeAppend(line);
  }

  private base() {
    return {
      ts: new Date().toISOString(),
      jobId: this.cfg.jobId,
      turnId: this.turnId as string,
      jobType: this.cfg.jobType,
    } as const;
  }

  private safeAppend(
    line:
      | TraceThinkingLine
      | TraceToolCallLine
      | TraceRunCommandLine
      | TraceAssistantMessageLine
      | TraceJobStatusLine
      | TraceChoicePresentedLine
      | TraceChoiceResolvedLine
      | TraceFileWriteLine
      | ChatStatusLine,
  ): void {
    this.session.appendLine('chat', line).catch((err) => {
      logger.warn(
        `[Chat] appendLine(${line.type}) failed: ${(err as Error)?.message ?? err}`,
        { component: 'TraceAppender' },
      );
    });
  }
}

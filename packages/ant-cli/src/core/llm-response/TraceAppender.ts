/**
 * TraceAppender — fire-and-forget trace.jsonl writer
 *
 * Session redesign §2.4 / §16.2: trace.jsonl is the UI rendering SSOT for
 * chat history. This helper writes 5 line types (assistant_thinking /
 * tool_call / run_command / assistant_message / job_status) from the worker
 * process, complementing the pre-existing writers (`user_turn` via
 * orchestrator + `file_write` via tool side-effects).
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
      | TraceFileWriteLine,
  ): void {
    this.session.appendLine('trace', line).catch((err) => {
      logger.warn(
        `[Trace] appendLine(${line.type}) failed: ${(err as Error)?.message ?? err}`,
        { component: 'TraceAppender' },
      );
    });
  }
}

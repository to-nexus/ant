/**
 * Emit trace.jsonl `file_write` lines from tool sideEffects.
 *
 * SSOT per session redesign §2.4 / §12: learn/breadcrumb reads
 * `trace.jsonl type='file_write'` entries to count touched files. This
 * helper turns the uniform `ToolSideEffect` shape into trace lines at the
 * point where tool execution reports them.
 *
 * Fire-and-forget: trace writes are best-effort — they must never break or
 * slow tool execution. All errors are logged and swallowed.
 */

import type { SessionPort } from '../../../../../../core/ports/session';
import type { ToolSideEffect } from '../../../../../common/tool/types';
import type { TraceFileWriteLine, LogJobType } from '@ant/shared';

export interface EmitFileWriteTraceInput {
  session?: SessionPort;
  jobId?: string;
  turnId?: string;
  jobType: LogJobType;
  sideEffects?: ToolSideEffect[];
}

/**
 * Schedule `appendLine('trace', ...)` for every file-mutating side effect
 * observed on a tool result. Does not await — callers stay synchronous.
 */
export function emitFileWriteTrace(input: EmitFileWriteTraceInput): void {
  const { session, jobId, turnId, jobType, sideEffects } = input;
  if (!session || !jobId || !turnId || !sideEffects || sideEffects.length === 0) {
    return;
  }
  const ts = new Date().toISOString();
  for (const effect of sideEffects) {
    let operation: TraceFileWriteLine['operation'] | undefined;
    let pathStr: string | undefined;
    switch (effect.type) {
      case 'fileCreated':
        operation = 'create';
        pathStr = effect.path;
        break;
      case 'fileModified':
        operation = 'update';
        pathStr = effect.path;
        break;
      case 'fileDeleted':
        operation = 'delete';
        pathStr = effect.path;
        break;
      default:
        continue;
    }
    if (!pathStr) continue;
    const line: TraceFileWriteLine = {
      type: 'file_write',
      ts,
      jobId,
      turnId,
      jobType,
      path: pathStr,
      operation,
    };
    session
      .appendLine('trace', line)
      .catch((err) =>
        console.warn('⚠️  [Trace] appendLine(file_write) failed:', err),
      );
  }
}

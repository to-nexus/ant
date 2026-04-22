/**
 * Unit tests for the trace.jsonl → ChatMessage[] adapter introduced in
 * session redesign §16.2 Step 2.
 */

import { describe, it, expect } from 'vitest';
import type { TraceLine } from '@ant/shared';
import { buildChatMessagesFromTrace } from '../../../src/periphery/adapters/http/services/ChatService/TraceToChatMessages';

function mkLine<T extends TraceLine>(line: T): T {
  return line;
}

describe('TraceToChatMessages — buildChatMessagesFromTrace', () => {
  it('returns [] when trace is empty', () => {
    expect(buildChatMessagesFromTrace({ traceLines: [] })).toEqual([]);
  });

  it('emits user + assistant ChatMessages per turn in chronological order', () => {
    const lines: TraceLine[] = [
      mkLine({
        type: 'user_turn',
        ts: '2026-04-20T00:00:00.000Z',
        jobId: 'job-1',
        turnId: 't-aaaa',
        jobType: 'code',
        text: 'refactor the auth module',
        sourceRef: 'feature.jsonl#t-aaaa',
      }),
      mkLine({
        type: 'assistant_thinking',
        ts: '2026-04-20T00:00:01.000Z',
        jobId: 'job-1',
        turnId: 't-aaaa',
        jobType: 'code',
        text: 'Reading existing code…',
      }),
      mkLine({
        type: 'tool_call',
        ts: '2026-04-20T00:00:02.000Z',
        jobId: 'job-1',
        turnId: 't-aaaa',
        jobType: 'code',
        tool: 'read_file',
        args: { path: 'src/auth.ts' },
      }),
      mkLine({
        type: 'assistant_message',
        ts: '2026-04-20T00:00:03.000Z',
        jobId: 'job-1',
        turnId: 't-aaaa',
        jobType: 'code',
        text: 'Here is the refactor plan…',
      }),
    ];

    const messages = buildChatMessagesFromTrace({ traceLines: lines });

    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(messages[0].contents).toEqual([
      { type: 'text', content: 'refactor the auth module' },
    ]);
    const asst = messages[1];
    // read_file is a dedicated-status tool — toolDispatch SSOT routes
    // it to the `read` WorkingCard content type instead of a generic
    // `tool_action`.
    expect(asst.contents.map((c) => c.type)).toEqual([
      'thinking',
      'read',
      'text',
    ]);
    expect(asst.contents[1].metadata?.filePath).toBe('src/auth.ts');
  });

  it('skips tool_call(run_command) — the companion run_command line owns the TerminalCard', () => {
    const lines: TraceLine[] = [
      mkLine({
        type: 'user_turn',
        ts: '2026-04-20T00:00:00.000Z',
        jobId: 'job-1',
        turnId: 't-rc',
        jobType: 'code',
        text: 'run tests',
        sourceRef: 'feature.jsonl#t-rc',
      }),
      mkLine({
        type: 'tool_call',
        ts: '2026-04-20T00:00:01.000Z',
        jobId: 'job-1',
        turnId: 't-rc',
        jobType: 'code',
        tool: 'run_command',
        args: { command: 'pnpm test' },
      }),
      mkLine({
        type: 'run_command',
        ts: '2026-04-20T00:00:02.000Z',
        jobId: 'job-1',
        turnId: 't-rc',
        jobType: 'code',
        cmd: 'pnpm test',
        exitCode: 0,
        stdout: 'ok',
      }),
    ];
    const messages = buildChatMessagesFromTrace({ traceLines: lines });
    const asst = messages[1];
    // Only one card: the `command` one from the run_command line.
    // tool_call(run_command) is intentionally skipped to avoid duplication.
    expect(asst.contents.map((c) => c.type)).toEqual(['command']);
  });

  it('skips tool_call(edit_file) — the companion file_write line owns the FileCard', () => {
    const lines: TraceLine[] = [
      mkLine({
        type: 'user_turn',
        ts: '2026-04-20T00:00:00.000Z',
        jobId: 'job-1',
        turnId: 't-ef',
        jobType: 'code',
        text: 'tweak',
        sourceRef: 'feature.jsonl#t-ef',
      }),
      mkLine({
        type: 'tool_call',
        ts: '2026-04-20T00:00:01.000Z',
        jobId: 'job-1',
        turnId: 't-ef',
        jobType: 'code',
        tool: 'edit_file',
        args: { path: 'src/x.ts', old_str: 'a', new_str: 'b' },
      }),
      mkLine({
        type: 'file_write',
        ts: '2026-04-20T00:00:02.000Z',
        jobId: 'job-1',
        turnId: 't-ef',
        jobType: 'code',
        path: 'src/x.ts',
        operation: 'update',
        diffBefore: 'a',
        diffAfter: 'b',
      }),
    ];
    const messages = buildChatMessagesFromTrace({ traceLines: lines });
    const asst = messages[1];
    expect(asst.contents.map((c) => c.type)).toEqual(['file_edit']);
    expect(asst.contents[0].metadata?.filePath).toBe('src/x.ts');
    expect(asst.contents[0].metadata?.diffBefore).toBe('a');
    expect(asst.contents[0].metadata?.diffAfter).toBe('b');
  });

  it('renders a failure FileCard from tool_call(edit_file) when error is set', () => {
    const lines: TraceLine[] = [
      mkLine({
        type: 'user_turn',
        ts: '2026-04-20T00:00:00.000Z',
        jobId: 'job-1',
        turnId: 't-ff',
        jobType: 'code',
        text: 'fail',
        sourceRef: 'feature.jsonl#t-ff',
      }),
      mkLine({
        type: 'tool_call',
        ts: '2026-04-20T00:00:01.000Z',
        jobId: 'job-1',
        turnId: 't-ff',
        jobType: 'code',
        tool: 'edit_file',
        args: { path: 'src/x.ts', old_str: 'a', new_str: 'b' },
        error: 'old_str not found',
      }),
    ];
    const messages = buildChatMessagesFromTrace({ traceLines: lines });
    const asst = messages[1];
    expect(asst.contents.map((c) => c.type)).toEqual(['file_edit_failed']);
    expect(asst.contents[0].metadata?.filePath).toBe('src/x.ts');
    expect(asst.contents[0].metadata?.reason).toBe('old_str not found');
  });

  it('merges adjacent thinking lines into a single content block', () => {
    const lines: TraceLine[] = [
      mkLine({
        type: 'user_turn',
        ts: '2026-04-20T00:00:00.000Z',
        jobId: 'job-1',
        turnId: 't-bbbb',
        jobType: 'code',
        text: 'refactor',
        sourceRef: 'feature.jsonl#t-bbbb',
      }),
      mkLine({
        type: 'assistant_thinking',
        ts: '2026-04-20T00:00:01.000Z',
        jobId: 'job-1',
        turnId: 't-bbbb',
        jobType: 'code',
        text: 'Step 1 analysis',
      }),
      mkLine({
        type: 'assistant_thinking',
        ts: '2026-04-20T00:00:02.000Z',
        jobId: 'job-1',
        turnId: 't-bbbb',
        jobType: 'code',
        text: 'Step 2 plan',
      }),
    ];

    const messages = buildChatMessagesFromTrace({ traceLines: lines });
    const asst = messages[1];
    expect(asst.contents).toHaveLength(1);
    expect(asst.contents[0].type).toBe('thinking');
    expect(asst.contents[0].content).toBe('Step 1 analysis\nStep 2 plan');
  });

  it('maps file_write operations to file_create / file_edit / file_delete with rich payload', () => {
    const base = {
      ts: '2026-04-20T00:00:00.000Z',
      jobId: 'job-1',
      turnId: 't-cccc',
      jobType: 'code' as const,
    };
    const lines: TraceLine[] = [
      mkLine({
        type: 'user_turn',
        ...base,
        text: 'touch files',
        sourceRef: 'feature.jsonl#t-cccc',
      }),
      mkLine({
        type: 'file_write',
        ...base,
        ts: '2026-04-20T00:00:01.000Z',
        path: 'src/new.ts',
        operation: 'create',
        content: 'export const a = 1;\n',
      }),
      mkLine({
        type: 'file_write',
        ...base,
        ts: '2026-04-20T00:00:02.000Z',
        path: 'src/old.ts',
        operation: 'update',
        diffBefore: 'const a = 1;',
        diffAfter: 'const a = 2;',
      }),
      mkLine({
        type: 'file_write',
        ...base,
        ts: '2026-04-20T00:00:03.000Z',
        path: 'src/gone.ts',
        operation: 'delete',
      }),
      mkLine({
        type: 'file_write',
        ...base,
        ts: '2026-04-20T00:00:04.000Z',
        path: 'src/bad.ts',
        operation: 'create',
        error: 'disk full',
      }),
    ];

    const messages = buildChatMessagesFromTrace({ traceLines: lines });
    const asst = messages[1];
    expect(asst.contents.map((c) => c.type)).toEqual([
      'file_create',
      'file_edit',
      'file_delete',
      'file_create_failed',
    ]);
    expect(asst.contents.map((c) => c.metadata?.filePath)).toEqual([
      'src/new.ts',
      'src/old.ts',
      'src/gone.ts',
      'src/bad.ts',
    ]);
    // create surfaces full content
    expect(asst.contents[0].content).toBe('export const a = 1;\n');
    // update leaves content empty, surfaces diff via metadata
    expect(asst.contents[1].content).toBe('');
    expect(asst.contents[1].metadata?.diffBefore).toBe('const a = 1;');
    expect(asst.contents[1].metadata?.diffAfter).toBe('const a = 2;');
    // failed create carries the error in `reason`
    expect(asst.contents[3].metadata?.reason).toBe('disk full');
  });

  it('preserves run_command metadata (command, exitCode, stdout)', () => {
    const lines: TraceLine[] = [
      mkLine({
        type: 'user_turn',
        ts: '2026-04-20T00:00:00.000Z',
        jobId: 'job-1',
        turnId: 't-dddd',
        jobType: 'code',
        text: 'run tests',
        sourceRef: 'feature.jsonl#t-dddd',
      }),
      mkLine({
        type: 'run_command',
        ts: '2026-04-20T00:00:01.000Z',
        jobId: 'job-1',
        turnId: 't-dddd',
        jobType: 'code',
        cmd: 'pnpm test',
        exitCode: 0,
        stdout: 'ok',
      }),
    ];
    const messages = buildChatMessagesFromTrace({ traceLines: lines });
    const cmd = messages[1].contents[0];
    expect(cmd.type).toBe('command');
    expect(cmd.content).toBe('ok');
    expect(cmd.metadata?.command).toBe('pnpm test');
    expect(cmd.metadata?.exitCode).toBe(0);
  });

  it('skips collapsed lines', () => {
    const lines: TraceLine[] = [
      mkLine({
        type: 'user_turn',
        ts: '2026-04-20T00:00:00.000Z',
        jobId: 'job-1',
        turnId: 't-ee',
        jobType: 'code',
        text: 'visible',
        sourceRef: 'feature.jsonl#t-ee',
      }),
      mkLine({
        type: 'user_turn',
        ts: '2026-04-20T00:00:01.000Z',
        jobId: 'job-2',
        turnId: 't-ff',
        jobType: 'code',
        text: 'hidden',
        sourceRef: 'feature.jsonl#t-ff',
        collapsed: true,
      }),
    ];

    const messages = buildChatMessagesFromTrace({ traceLines: lines });
    expect(messages).toHaveLength(1);
    expect(messages[0].contents[0].content).toBe('visible');
  });

  it('skips job_status lines entirely (SSE workflow handles status)', () => {
    const lines: TraceLine[] = [
      mkLine({
        type: 'user_turn',
        ts: '2026-04-20T00:00:00.000Z',
        jobId: 'job-1',
        turnId: 't-gg',
        jobType: 'code',
        text: 'go',
        sourceRef: 'feature.jsonl#t-gg',
      }),
      mkLine({
        type: 'job_status',
        ts: '2026-04-20T00:00:01.000Z',
        jobId: 'job-1',
        turnId: 't-gg',
        jobType: 'code',
        phase: 'resolve',
      }),
    ];
    const messages = buildChatMessagesFromTrace({ traceLines: lines });
    // assistant message is skipped because job_status contributes no content
    expect(messages.map((m) => m.role)).toEqual(['user']);
  });

  it('places untagged trace events in __untagged__ bucket without crashing', () => {
    const lines: TraceLine[] = [
      mkLine({
        type: 'assistant_message',
        ts: '2026-04-20T00:00:00.000Z',
        jobId: 'job-1',
        turnId: '',
        jobType: 'code',
        text: 'orphaned text',
      }),
    ];
    const messages = buildChatMessagesFromTrace({ traceLines: lines });
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe('assistant');
    expect(messages[0].contents[0].content).toBe('orphaned text');
  });
});

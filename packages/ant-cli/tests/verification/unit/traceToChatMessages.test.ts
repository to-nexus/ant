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
    expect(asst.contents.map((c) => c.type)).toEqual([
      'thinking',
      'tool_action',
      'text',
    ]);
    expect(asst.contents[1].metadata?.toolName).toBe('read_file');
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

  it('maps file_write operations to file_create / file_edit / file_delete', () => {
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
      }),
      mkLine({
        type: 'file_write',
        ...base,
        ts: '2026-04-20T00:00:02.000Z',
        path: 'src/old.ts',
        operation: 'update',
      }),
      mkLine({
        type: 'file_write',
        ...base,
        ts: '2026-04-20T00:00:03.000Z',
        path: 'src/gone.ts',
        operation: 'delete',
      }),
    ];

    const messages = buildChatMessagesFromTrace({ traceLines: lines });
    const asst = messages[1];
    expect(asst.contents.map((c) => c.type)).toEqual([
      'file_create',
      'file_edit',
      'file_delete',
    ]);
    expect(asst.contents.map((c) => c.metadata?.filePath)).toEqual([
      'src/new.ts',
      'src/old.ts',
      'src/gone.ts',
    ]);
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

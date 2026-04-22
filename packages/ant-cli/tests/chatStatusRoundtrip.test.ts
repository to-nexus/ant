/**
 * Chat SSOT roundtrip guard — locks in the invariant from the chat SSOT
 * fragmentation purge plan:
 *
 *   every chat card has ONE authoritative on-disk shape (chat_status) and
 *   replay reproduces the identical MessageContent by feeding the same
 *   (statusType, metadata) pair back through `generateChatStatusContent`.
 *
 * Any future regression that makes replay drift from broadcast (e.g. a
 * new inline replay builder reintroducing "empty content" WorkingCards)
 * will fail one of these assertions.
 */

import { describe, it, expect } from 'vitest';
import type { TraceLine, ChatStatusLine, ChatStatusType } from '@ant/shared';
import { buildChatMessagesFromTrace } from '../src/periphery/adapters/http/services/ChatService/TraceToChatMessages';
import { generateChatStatusContent } from '../src/core/llm-response/generateStatusContent';

function mkChatStatus(
  statusType: ChatStatusType,
  metadata: Record<string, unknown>,
  turnId = 't-aaaa',
): ChatStatusLine {
  return {
    type: 'chat_status',
    ts: '2026-04-23T00:00:01.000Z',
    jobId: 'job-1',
    turnId,
    jobType: 'code',
    statusType,
    metadata,
  };
}

function mkUserTurn(turnId = 't-aaaa', text = 'hello'): TraceLine {
  return {
    type: 'user_turn',
    ts: '2026-04-23T00:00:00.000Z',
    jobId: 'job-1',
    turnId,
    jobType: 'code',
    text,
    sourceRef: `feature.jsonl#${turnId}`,
  };
}

describe('chat SSOT roundtrip — (statusType, metadata) → MessageContent', () => {
  // Table of card kinds the live path may emit. Each row locks both
  // (a) the type of the rendered MessageContent and (b) the presence of
  // the originating metadata that card components read. Labels (the
  // `content` string) are produced by `generateChatStatusContent` and
  // compared against the live function to guarantee byte-identical
  // replay.
  const rows: Array<{
    name: string;
    statusType: ChatStatusType;
    metadata: Record<string, unknown>;
    expectContentContains?: string;
  }> = [
    { name: 'read_file', statusType: 'read', metadata: { filePath: 'src/auth.ts' }, expectContentContains: 'src/auth.ts' },
    { name: 'list_files', statusType: 'listed_files', metadata: { directory: 'src', pattern: '*.ts', filesCount: 12, totalFiles: 20 }, expectContentContains: '*.ts' },
    { name: 'search_code', statusType: 'searched_code', metadata: { pattern: 'TODO', totalMatches: 5, filesCount: 3 }, expectContentContains: '5 matches' },
    { name: 'search_reference', statusType: 'searched_reference', metadata: { project: 'libx', filesCount: 2 }, expectContentContains: 'libx' },
    { name: 'mkdir tool_action', statusType: 'tool_action', metadata: { toolName: 'mkdir', actionIcon: '📁', filePath: 'src/foo', content: 'Created directory: src/foo' }, expectContentContains: 'src/foo' },
    { name: 'generic tool_action', statusType: 'tool_action', metadata: { toolName: 'search_web', actionIcon: '🔧', content: 'search_web: {"query":"ant"}' }, expectContentContains: 'search_web' },
    { name: 'file_create', statusType: 'file_create', metadata: { filePath: 'src/new.ts', content: 'export const a = 1;\n' } },
    { name: 'file_edit', statusType: 'file_edit', metadata: { filePath: 'src/x.ts', diffBefore: 'a', diffAfter: 'b' } },
    { name: 'file_delete', statusType: 'file_delete', metadata: { filePath: 'src/gone.ts' } },
    { name: 'file_create_failed', statusType: 'file_create_failed', metadata: { filePath: 'src/bad.ts', reason: 'disk full' }, expectContentContains: 'src/bad.ts' },
    { name: 'file_edit_failed', statusType: 'file_edit_failed', metadata: { filePath: 'src/bad.ts', reason: 'old_str not found' }, expectContentContains: 'old_str not found' },
    { name: 'command', statusType: 'command', metadata: { command: 'pnpm test', exitCode: 0, output: 'ok' } },
    { name: 'context_loaded', statusType: 'context_loaded', metadata: { items: [{ label: 'PRD', detail: '5234 chars' }] }, expectContentContains: 'PRD' },
    { name: 'indexed', statusType: 'indexed', metadata: { filesIndexed: 10, chunks: 50, tokens: 12000, duration: 3500 }, expectContentContains: '10 files' },
  ];

  for (const row of rows) {
    it(`${row.name}: replay produces the same MessageContent the live path built`, () => {
      const lines: TraceLine[] = [
        mkUserTurn(),
        mkChatStatus(row.statusType, row.metadata),
      ];
      const messages = buildChatMessagesFromTrace({ traceLines: lines });
      expect(messages.map((m) => m.role)).toEqual(['user', 'assistant']);

      const assistant = messages[1];
      expect(assistant.contents).toHaveLength(1);
      const card = assistant.contents[0];

      // Type must match the statusType (MessageContent.type and
      // ChatStatusType share the same identifier for every card kind).
      expect(card.type).toBe(row.statusType);

      // Content must equal the live generator's output verbatim — this
      // is the core SSOT guarantee.
      const expectedMetadata = { ...row.metadata, timestamp: '2026-04-23T00:00:01.000Z' };
      const expectedContent = generateChatStatusContent(
        row.statusType,
        expectedMetadata as Record<string, any>,
      );
      expect(card.content).toBe(expectedContent);
      if (row.expectContentContains) {
        expect(card.content).toContain(row.expectContentContains);
      }

      // Metadata must round-trip intact (card components read these
      // keys; dropping any would silently blank out a FileCard diff or
      // WorkingCard label).
      for (const [key, value] of Object.entries(row.metadata)) {
        expect((card.metadata as Record<string, unknown>)?.[key]).toEqual(value);
      }
    });
  }

  it('chat_status(read) with an empty path still renders a non-empty label', () => {
    // Regression guard for the bug that motivated the migration: the
    // pre-SSOT replay path produced `content: ''` for read_file /
    // list_files / search_code cards, leaving WorkingCard with only an
    // icon and no text. After the SSOT collapse `content` is always
    // generated from the same function the live path uses.
    const lines: TraceLine[] = [
      mkUserTurn(),
      mkChatStatus('read', { filePath: '' }),
    ];
    const messages = buildChatMessagesFromTrace({ traceLines: lines });
    const card = messages[1].contents[0];
    expect(card.type).toBe('read');
    expect(card.content).not.toBe('');
  });

  it('chat_status(file_edit) + companion file_write dedup to a single card', () => {
    // During the migration both lines exist; dedup should prefer the
    // chat_status path so the UI does not render two FileCards for the
    // same edit.
    const lines: TraceLine[] = [
      mkUserTurn(),
      mkChatStatus('file_edit', {
        filePath: 'src/x.ts',
        diffBefore: 'a',
        diffAfter: 'b',
      }),
      {
        type: 'file_write',
        ts: '2026-04-23T00:00:02.000Z',
        jobId: 'job-1',
        turnId: 't-aaaa',
        jobType: 'code',
        path: 'src/x.ts',
        operation: 'update',
        diffBefore: 'a',
        diffAfter: 'b',
      },
    ];
    const messages = buildChatMessagesFromTrace({ traceLines: lines });
    const assistant = messages[1];
    expect(assistant.contents.map((c) => c.type)).toEqual(['file_edit']);
    expect(assistant.contents[0].metadata?.diffBefore).toBe('a');
    expect(assistant.contents[0].metadata?.diffAfter).toBe('b');
  });

  it('chat_status(command) + companion run_command dedup to a single card', () => {
    const lines: TraceLine[] = [
      mkUserTurn(),
      mkChatStatus('command', {
        command: 'pnpm test',
        exitCode: 0,
        output: 'ok',
      }),
      {
        type: 'run_command',
        ts: '2026-04-23T00:00:02.000Z',
        jobId: 'job-1',
        turnId: 't-aaaa',
        jobType: 'code',
        cmd: 'pnpm test',
        exitCode: 0,
        stdout: 'ok',
      },
    ];
    const messages = buildChatMessagesFromTrace({ traceLines: lines });
    const assistant = messages[1];
    expect(assistant.contents.map((c) => c.type)).toEqual(['command']);
    expect(assistant.contents[0].metadata?.command).toBe('pnpm test');
    expect(assistant.contents[0].metadata?.exitCode).toBe(0);
  });

  it('chat_status(read) + companion tool_call(read_file) dedup to a single card', () => {
    const lines: TraceLine[] = [
      mkUserTurn(),
      mkChatStatus('read', { filePath: 'src/auth.ts' }),
      {
        type: 'tool_call',
        ts: '2026-04-23T00:00:02.000Z',
        jobId: 'job-1',
        turnId: 't-aaaa',
        jobType: 'code',
        tool: 'read_file',
        args: { path: 'src/auth.ts' },
      },
    ];
    const messages = buildChatMessagesFromTrace({ traceLines: lines });
    const assistant = messages[1];
    expect(assistant.contents.map((c) => c.type)).toEqual(['read']);
    expect(assistant.contents[0].metadata?.filePath).toBe('src/auth.ts');
    expect(assistant.contents[0].content).toContain('src/auth.ts');
  });

  it('legacy tool_call(read_file) without chat_status still renders a non-empty label', () => {
    // Backward-compat guard: feature folders created before the SSOT
    // collapse only have tool_call lines. The patched
    // dispatchToolCallToContent now produces content via the shared
    // generator, so legacy data does not regress the WorkingCard either.
    const lines: TraceLine[] = [
      mkUserTurn(),
      {
        type: 'tool_call',
        ts: '2026-04-23T00:00:02.000Z',
        jobId: 'job-1',
        turnId: 't-aaaa',
        jobType: 'code',
        tool: 'read_file',
        args: { path: 'src/auth.ts' },
      },
    ];
    const messages = buildChatMessagesFromTrace({ traceLines: lines });
    const card = messages[1].contents[0];
    expect(card.type).toBe('read');
    expect(card.content).toContain('src/auth.ts');
  });
});

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
import type { ChatLine, ChatStatusLine, ChatStatusType } from '@ant/shared';
import { buildChatMessagesFromChatLog } from '../src/periphery/adapters/http/services/ChatService/ChatLogToMessages';
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

function mkUserTurn(turnId = 't-aaaa', text = 'hello'): ChatLine {
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
    // Plan card: live path accumulates `plan_content` chunks into a single
    // card and emits only the terminal `plan` line with the full text in
    // `metadata.content`. Replay must reproduce the full plan from that
    // single line — not from per-chunk `plan_generating` lines (those
    // are now LIVE_ONLY and never hit chat.jsonl).
    { name: 'plan (full content)', statusType: 'plan', metadata: { content: '### Plan\n- step one\n- step two\n', taskName: 'Main task' }, expectContentContains: 'step one' },
  ];

  for (const row of rows) {
    it(`${row.name}: replay produces the same MessageContent the live path built`, () => {
      const lines: ChatLine[] = [
        mkUserTurn(),
        mkChatStatus(row.statusType, row.metadata),
      ];
      const messages = buildChatMessagesFromChatLog({ chatLines: lines });
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
    const lines: ChatLine[] = [
      mkUserTurn(),
      mkChatStatus('read', { filePath: '' }),
    ];
    const messages = buildChatMessagesFromChatLog({ chatLines: lines });
    const card = messages[1].contents[0];
    expect(card.type).toBe('read');
    expect(card.content).not.toBe('');
  });

  it('assistant_thinking and chat_status interleave in timestamp order', () => {
    const base = { jobId: 'job-1', turnId: 't-aaaa', jobType: 'code' as const };
    const lines: ChatLine[] = [
      mkUserTurn(),
      {
        type: 'assistant_thinking',
        ts: '2026-04-23T00:00:00.500Z',
        ...base,
        text: 'Reading the file first…',
      },
      mkChatStatus('read', { filePath: 'src/auth.ts' }),
      {
        type: 'assistant_message',
        ts: '2026-04-23T00:00:02.000Z',
        ...base,
        text: 'Here is what I found.',
      },
    ];
    const messages = buildChatMessagesFromChatLog({ chatLines: lines });
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(messages[1].contents.map((c) => c.type)).toEqual(['thinking', 'read', 'text']);
  });

  it('choice_presented + choice_resolved pair renders a single resolved card', () => {
    const base = { jobId: 'job-1', turnId: 't-aaaa', jobType: 'code' as const };
    const lines: ChatLine[] = [
      mkUserTurn(),
      {
        type: 'choice_presented',
        ts: '2026-04-23T00:00:01.000Z',
        ...base,
        cardId: 'card-1',
        cardType: 'cancelled',
        prompt: 'Job paused — resume?',
        payload: { reason: 'user_paused', jobId: 'job-1' },
      },
      {
        type: 'choice_resolved',
        ts: '2026-04-23T00:00:02.000Z',
        ...base,
        cardId: 'card-1',
        choiceSelected: 'resume',
        resolvedLabel: 'Resumed',
      },
    ];
    const messages = buildChatMessagesFromChatLog({ chatLines: lines });
    const card = messages[1].contents[0];
    expect(card.type).toBe('cancelled');
    expect(card.content).toBe('Job paused — resume?');
    expect(card.metadata?.resolvedLabel).toBe('Resumed');
    expect(card.metadata?.choiceSelected).toBe('resume');
    expect(card.metadata?.resolved).toBe(true);
  });
});

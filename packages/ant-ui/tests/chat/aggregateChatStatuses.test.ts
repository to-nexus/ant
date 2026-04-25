/**
 * aggregateChatStatuses — unit tests.
 *
 * Phase 11 chat-SSOT: the aggregator now operates on `ChatStatusLine[]`
 * (the SSOT line type) instead of the legacy `MessageContent[]`
 * envelope. Each test fixture is a tiny `ChatStatusLine` helper.
 *
 * Locks the render-time adjacent-merge behaviour (Read: N files etc.) so
 * regressions show up before they reach the chat UI.
 *
 * Runner: vitest. No framework-specific features.
 */

import { describe, it, expect } from 'vitest';
import type { ChatStatusLine, ChatStatusType } from '@ant/shared';
import { generateChatStatusContent } from '@ant/shared';
import {
  aggregateChatStatuses,
} from '../../src/presentation/components/chat/aggregateChatStatuses';

let cardCounter = 0;
function line(
  statusType: ChatStatusType,
  metadata: Record<string, unknown> = {},
): ChatStatusLine {
  cardCounter += 1;
  return {
    type: 'chat_status',
    ts: new Date(2026, 0, 1, 0, 0, cardCounter).toISOString(),
    jobId: 'j1',
    turnId: 't1',
    jobType: 'code',
    cardId: `card-${cardCounter}`,
    statusType,
    metadata,
  };
}

/** Build the rendered body string for an aggregator output entry. */
function bodyOf(entry: { line: ChatStatusLine }): string {
  return generateChatStatusContent(entry.line.statusType, entry.line.metadata as any);
}

describe('aggregateChatStatuses — pass-through', () => {
  it('returns empty array for empty input', () => {
    expect(aggregateChatStatuses([])).toEqual([]);
  });

  it('keeps a single read card verbatim (no merge)', () => {
    const input = [line('read', { filePath: 'a.ts' })];
    const out = aggregateChatStatuses(input);
    expect(out).toHaveLength(1);
    expect(out[0].mergedCount).toBe(1);
    expect(out[0].line).toBe(input[0]);
    // Singleton buckets preserve BE SSOT — no `aggregated` marker.
    expect(out[0].line.metadata).not.toHaveProperty('aggregated');
  });

  it('passes non-aggregatable status types unchanged', () => {
    const input: ChatStatusLine[] = [
      line('text', {}),
      line('file_create', { filePath: 'a.ts' }),
    ];
    const out = aggregateChatStatuses(input);
    expect(out).toHaveLength(2);
    expect(out[0].line).toBe(input[0]);
    expect(out[1].line).toBe(input[1]);
  });
});

describe('aggregateChatStatuses — read family adjacent merge', () => {
  it('merges 3 adjacent read cards into "Read: 3 files"', () => {
    const input = [
      line('read', { filePath: 'a.ts' }),
      line('read', { filePath: 'b.ts' }),
      line('read', { filePath: 'c.ts' }),
    ];
    const out = aggregateChatStatuses(input);
    expect(out).toHaveLength(1);
    expect(out[0].originalIndex).toBe(0);
    expect(out[0].mergedCount).toBe(3);
    expect(out[0].line.statusType).toBe('read');
    expect(out[0].line.metadata?.filesList).toEqual(['a.ts', 'b.ts', 'c.ts']);
    expect(out[0].line.metadata).toMatchObject({ aggregated: true });
  });

  it('dedupes repeated filePaths across merges', () => {
    const input = [
      line('read', { filePath: 'a.ts' }),
      line('read', { filePath: 'a.ts' }),
      line('read', { filePath: 'b.ts' }),
    ];
    const out = aggregateChatStatuses(input);
    expect(out).toHaveLength(1);
    expect(out[0].line.metadata?.filesList).toEqual(['a.ts', 'b.ts']);
  });

  it('does NOT merge across a non-matching family (read → listed_files → read)', () => {
    const input = [
      line('read', { filePath: 'a.ts' }),
      line('listed_files', {
        filesCount: 2,
        totalFiles: 2,
        filesList: ['x.ts', 'y.ts'],
      }),
      line('read', { filePath: 'b.ts' }),
    ];
    const out = aggregateChatStatuses(input);
    expect(out).toHaveLength(3);
    expect(out[0].line.statusType).toBe('read');
    expect(out[1].line.statusType).toBe('listed_files');
    expect(out[2].line.statusType).toBe('read');
  });
});

describe('aggregateChatStatuses — trailing progress merge', () => {
  it('collapses [read, read, reading] into a single in-flight aggregate', () => {
    const input = [
      line('read', { filePath: 'a.ts' }),
      line('read', { filePath: 'b.ts' }),
      line('reading', { filePath: 'c.ts' }),
    ];
    const out = aggregateChatStatuses(input);
    expect(out).toHaveLength(1);
    const entry = out[0];
    expect(entry.mergedCount).toBe(3);
    expect(entry.line.statusType).toBe('reading');
    expect(entry.line.metadata?.filesList).toEqual(['a.ts', 'b.ts']);
    // Trailing in-flight path is surfaced via detail line, not filesList.
    expect(entry.line.metadata).toMatchObject({
      currentFilePath: 'c.ts',
      detail: 'In flight: c.ts',
    });
  });

  it('promotes an in-flight current path to filesList when the next completion arrives', () => {
    const input = [
      line('read', { filePath: 'a.ts' }),
      line('reading', { filePath: 'b.ts' }),
      line('read', { filePath: 'b.ts' }),
    ];
    const out = aggregateChatStatuses(input);
    expect(out).toHaveLength(1);
    expect(out[0].line.statusType).toBe('read');
    expect(out[0].line.metadata?.filesList).toEqual(['a.ts', 'b.ts']);
    expect(out[0].line.metadata?.currentFilePath).toBeUndefined();
  });
});

describe('aggregateChatStatuses — listed_files scope lock', () => {
  it('merges two listings with the same pattern', () => {
    const input = [
      line('listed_files', {
        filesCount: 5, totalFiles: 10, pattern: 'src',
        filesList: ['a', 'b'],
      }),
      line('listed_files', {
        filesCount: 3, totalFiles: 4, pattern: 'src',
        filesList: ['c'],
      }),
    ];
    const out = aggregateChatStatuses(input);
    expect(out).toHaveLength(1);
    expect(out[0].line.metadata?.filesList).toEqual(['a', 'b', 'c']);
    expect(out[0].line.metadata?.pattern).toBe('src');
    expect(out[0].line.metadata?.filesCount).toBe(8);
    expect(out[0].line.metadata?.totalFiles).toBe(14);
  });

  it('does NOT merge listings with different patterns', () => {
    const input = [
      line('listed_files', {
        filesCount: 5, totalFiles: 10, pattern: 'src',
      }),
      line('listed_files', {
        filesCount: 3, totalFiles: 4, pattern: 'tests',
      }),
    ];
    const out = aggregateChatStatuses(input);
    expect(out).toHaveLength(2);
  });

  it('treats "no pattern" as its own scope (undefined !== "src")', () => {
    const input = [
      line('listed_files', {
        filesCount: 5, totalFiles: 5,
      }),
      line('listed_files', {
        filesCount: 3, totalFiles: 3, pattern: 'src',
      }),
    ];
    const out = aggregateChatStatuses(input);
    expect(out).toHaveLength(2);
  });
});

describe('aggregateChatStatuses — error / cancelled boundary', () => {
  it('does not merge across an errored read slot', () => {
    const input = [
      line('read', { filePath: 'a.ts' }),
      line('read', { filePath: 'b.ts', error: true }),
      line('read', { filePath: 'c.ts' }),
    ];
    const out = aggregateChatStatuses(input);
    expect(out).toHaveLength(3);
    expect(out[1].line.metadata?.error).toBe(true);
  });

  it('treats cancelled as a non-read family — read buckets close around it', () => {
    const input: ChatStatusLine[] = [
      line('read', { filePath: 'a.ts' }),
      line('cancelled', {}),
      line('read', { filePath: 'b.ts' }),
    ];
    const out = aggregateChatStatuses(input);
    expect(out).toHaveLength(3);
    expect(out[1].line.statusType).toBe('cancelled');
  });
});

describe('aggregateChatStatuses — other families', () => {
  it('merges adjacent grepped cards by filesCount + filesList', () => {
    const input = [
      line('grepped', { filesCount: 3, filesList: ['a', 'b', 'c'] }),
      line('grepped', { filesCount: 2, filesList: ['c', 'd'] }),
    ];
    const out = aggregateChatStatuses(input);
    expect(out).toHaveLength(1);
    // filesList dedup: c appears once.
    expect(out[0].line.metadata?.filesList).toEqual(['a', 'b', 'c', 'd']);
    expect(out[0].line.metadata?.filesCount).toBe(5);
  });

  it('merges adjacent searched_code cards by totalMatches + filesCount', () => {
    const input = [
      line('searched_code', { totalMatches: 10, filesCount: 3 }),
      line('searched_code', { totalMatches: 5, filesCount: 2 }),
    ];
    const out = aggregateChatStatuses(input);
    expect(out).toHaveLength(1);
    expect(out[0].line.metadata?.totalMatches).toBe(15);
    expect(out[0].line.metadata?.filesCount).toBe(5);
  });

  it('merges adjacent retrieved cards', () => {
    const input = [
      line('retrieved', { filesCount: 3, filesList: ['a', 'b', 'c'] }),
      line('retrieved', { filesCount: 2, filesList: ['d', 'e'] }),
    ];
    const out = aggregateChatStatuses(input);
    expect(out).toHaveLength(1);
    expect(out[0].line.metadata?.filesList).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(out[0].line.metadata?.filesCount).toBe(5);
  });

  it('merges adjacent explored cards', () => {
    const input = [
      line('explored', { filesCount: 2, filesList: ['a', 'b'] }),
      line('explored', { filesCount: 1, filesList: ['c'] }),
    ];
    const out = aggregateChatStatuses(input);
    expect(out).toHaveLength(1);
    expect(out[0].line.metadata?.filesCount).toBe(3);
  });

  it('does NOT merge across different families (read + listed_files)', () => {
    const input = [
      line('read', { filePath: 'a.ts' }),
      line('listed_files', { filesCount: 2, totalFiles: 2 }),
    ];
    const out = aggregateChatStatuses(input);
    expect(out).toHaveLength(2);
  });
});

describe('aggregateChatStatuses — originalIndex stability', () => {
  it('propagates the first slot index for React keys', () => {
    const input: ChatStatusLine[] = [
      line('text', {}),
      line('read', { filePath: 'a.ts' }),
      line('read', { filePath: 'b.ts' }),
      line('read', { filePath: 'c.ts' }),
      line('text', {}),
    ];
    const out = aggregateChatStatuses(input);
    expect(out).toHaveLength(3);
    expect(out[0].originalIndex).toBe(0);
    expect(out[1].originalIndex).toBe(1); // first slot of the read bucket
    expect(out[1].mergedCount).toBe(3);
    expect(out[2].originalIndex).toBe(4);
  });
});

describe('aggregateChatStatuses — body rendering via generateChatStatusContent', () => {
  // Smoke-test that the synthesized aggregate line still produces a body
  // through the shared serializer. The body is no longer baked into the
  // aggregator output; downstream `lineToContent` calls
  // `generateChatStatusContent(statusType, metadata)` to produce it.
  it('aggregated read line renders "Read: N files" via the shared serializer', () => {
    const input = [
      line('read', { filePath: 'a.ts' }),
      line('read', { filePath: 'b.ts' }),
      line('read', { filePath: 'c.ts' }),
    ];
    const out = aggregateChatStatuses(input);
    const body = bodyOf(out[0]);
    // The body string is owned by `generateChatStatusContent`; we just
    // assert it produces *something* non-empty so the contract holds.
    expect(typeof body).toBe('string');
    expect(body.length).toBeGreaterThan(0);
  });
});

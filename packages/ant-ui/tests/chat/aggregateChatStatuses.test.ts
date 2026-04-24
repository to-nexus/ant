/**
 * aggregateChatStatuses — unit tests.
 *
 * Locks the render-time adjacent-merge behaviour (Read: N files etc.) so
 * regressions show up before they reach the chat UI.
 *
 * Runner: vitest. No framework-specific features.
 */

import { describe, it, expect } from 'vitest';
import type { MessageContent, MessageContentType } from '../../src/domain/models/chat';
import {
  aggregateChatStatuses,
} from '../../src/presentation/components/chat/aggregateChatStatuses';

function msg(
  type: MessageContentType,
  contentText: string,
  metadata: Record<string, unknown> = {},
): MessageContent {
  return {
    type,
    content: contentText,
    metadata: metadata as MessageContent['metadata'],
  };
}

describe('aggregateChatStatuses — pass-through', () => {
  it('returns empty array for empty input', () => {
    expect(aggregateChatStatuses([])).toEqual([]);
  });

  it('keeps a single read card verbatim (no merge)', () => {
    const input = [msg('read', 'Read: a.ts', { filePath: 'a.ts' })];
    const out = aggregateChatStatuses(input);
    expect(out).toHaveLength(1);
    expect(out[0].mergedCount).toBe(1);
    expect(out[0].content.content).toBe('Read: a.ts');
    // Singleton buckets preserve BE SSOT — no `aggregated` marker.
    expect(out[0].content.metadata).not.toHaveProperty('aggregated');
  });

  it('passes non-aggregatable types unchanged (text, file_create)', () => {
    const input: MessageContent[] = [
      msg('text', 'hello'),
      msg('file_create', '', { filePath: 'a.ts' }),
    ];
    const out = aggregateChatStatuses(input);
    expect(out).toHaveLength(2);
    expect(out[0].content).toBe(input[0]);
    expect(out[1].content).toBe(input[1]);
  });
});

describe('aggregateChatStatuses — read family adjacent merge', () => {
  it('merges 3 adjacent read cards into "Read: 3 files"', () => {
    const input = [
      msg('read', 'Read: a.ts', { filePath: 'a.ts' }),
      msg('read', 'Read: b.ts', { filePath: 'b.ts' }),
      msg('read', 'Read: c.ts', { filePath: 'c.ts' }),
    ];
    const out = aggregateChatStatuses(input);
    expect(out).toHaveLength(1);
    expect(out[0].originalIndex).toBe(0);
    expect(out[0].mergedCount).toBe(3);
    expect(out[0].content.type).toBe('read');
    expect(out[0].content.content).toBe('Read: 3 files');
    expect(out[0].content.metadata?.filesList).toEqual(['a.ts', 'b.ts', 'c.ts']);
    expect(out[0].content.metadata).toMatchObject({ aggregated: true });
  });

  it('dedupes repeated filePaths across merges', () => {
    const input = [
      msg('read', 'Read: a.ts', { filePath: 'a.ts' }),
      msg('read', 'Read: a.ts', { filePath: 'a.ts' }),
      msg('read', 'Read: b.ts', { filePath: 'b.ts' }),
    ];
    const out = aggregateChatStatuses(input);
    expect(out).toHaveLength(1);
    expect(out[0].content.metadata?.filesList).toEqual(['a.ts', 'b.ts']);
    expect(out[0].content.content).toBe('Read: 2 files');
  });

  it('does NOT merge across a non-matching family (read → listed_files → read)', () => {
    const input = [
      msg('read', 'Read: a.ts', { filePath: 'a.ts' }),
      msg('listed_files', 'Listed: 2/2 files', {
        filesCount: 2,
        totalFiles: 2,
        filesList: ['x.ts', 'y.ts'],
      }),
      msg('read', 'Read: b.ts', { filePath: 'b.ts' }),
    ];
    const out = aggregateChatStatuses(input);
    expect(out).toHaveLength(3);
    expect(out[0].content.content).toBe('Read: a.ts');
    expect(out[1].content.content).toBe('Listed: 2/2 files');
    expect(out[2].content.content).toBe('Read: b.ts');
  });
});

describe('aggregateChatStatuses — trailing progress merge', () => {
  it('collapses [read, read, reading] into a single in-flight aggregate', () => {
    const input = [
      msg('read', 'Read: a.ts', { filePath: 'a.ts' }),
      msg('read', 'Read: b.ts', { filePath: 'b.ts' }),
      msg('reading', 'Reading: c.ts...', { filePath: 'c.ts' }),
    ];
    const out = aggregateChatStatuses(input);
    expect(out).toHaveLength(1);
    const entry = out[0];
    expect(entry.mergedCount).toBe(3);
    expect(entry.content.type).toBe('reading');
    expect(entry.content.content).toBe('Reading: 3 files');
    expect(entry.content.metadata?.filesList).toEqual(['a.ts', 'b.ts']);
    // Trailing in-flight path is surfaced via detail line, not filesList.
    expect(entry.content.metadata).toMatchObject({
      currentFilePath: 'c.ts',
      detail: 'In flight: c.ts',
    });
  });

  it('promotes an in-flight current path to filesList when the next completion arrives', () => {
    const input = [
      msg('read', 'Read: a.ts', { filePath: 'a.ts' }),
      msg('reading', 'Reading: b.ts...', { filePath: 'b.ts' }),
      msg('read', 'Read: b.ts', { filePath: 'b.ts' }),
    ];
    const out = aggregateChatStatuses(input);
    expect(out).toHaveLength(1);
    expect(out[0].content.type).toBe('read');
    expect(out[0].content.content).toBe('Read: 2 files');
    expect(out[0].content.metadata?.filesList).toEqual(['a.ts', 'b.ts']);
    expect(out[0].content.metadata?.currentFilePath).toBeUndefined();
  });
});

describe('aggregateChatStatuses — listed_files scope lock', () => {
  it('merges two listings with the same pattern', () => {
    const input = [
      msg('listed_files', 'Listed: 5/10 files (src)', {
        filesCount: 5, totalFiles: 10, pattern: 'src',
        filesList: ['a', 'b'],
      }),
      msg('listed_files', 'Listed: 3/4 files (src)', {
        filesCount: 3, totalFiles: 4, pattern: 'src',
        filesList: ['c'],
      }),
    ];
    const out = aggregateChatStatuses(input);
    expect(out).toHaveLength(1);
    expect(out[0].content.content).toBe('Listed: 8/14 files (src)');
    expect(out[0].content.metadata?.filesList).toEqual(['a', 'b', 'c']);
    expect(out[0].content.metadata?.pattern).toBe('src');
  });

  it('does NOT merge listings with different patterns', () => {
    const input = [
      msg('listed_files', 'Listed: 5/10 files (src)', {
        filesCount: 5, totalFiles: 10, pattern: 'src',
      }),
      msg('listed_files', 'Listed: 3/4 files (tests)', {
        filesCount: 3, totalFiles: 4, pattern: 'tests',
      }),
    ];
    const out = aggregateChatStatuses(input);
    expect(out).toHaveLength(2);
    expect(out[0].content.content).toBe('Listed: 5/10 files (src)');
    expect(out[1].content.content).toBe('Listed: 3/4 files (tests)');
  });

  it('treats "no pattern" as its own scope (undefined !== "src")', () => {
    const input = [
      msg('listed_files', 'Listed: 5/5 files', {
        filesCount: 5, totalFiles: 5,
      }),
      msg('listed_files', 'Listed: 3/3 files (src)', {
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
      msg('read', 'Read: a.ts', { filePath: 'a.ts' }),
      msg('read', '❌ Read Failed: b.ts', { filePath: 'b.ts', error: true }),
      msg('read', 'Read: c.ts', { filePath: 'c.ts' }),
    ];
    const out = aggregateChatStatuses(input);
    expect(out).toHaveLength(3);
    expect(out[0].content.content).toBe('Read: a.ts');
    expect(out[1].content.metadata?.error).toBe(true);
    expect(out[2].content.content).toBe('Read: c.ts');
  });

  it('treats cancelled as a bucket boundary', () => {
    const input: MessageContent[] = [
      msg('read', 'Read: a.ts', { filePath: 'a.ts' }),
      msg('cancelled', 'Task cancelled'),
      msg('read', 'Read: b.ts', { filePath: 'b.ts' }),
    ];
    const out = aggregateChatStatuses(input);
    expect(out).toHaveLength(3);
    expect(out[1].content.type).toBe('cancelled');
  });
});

describe('aggregateChatStatuses — other families', () => {
  it('merges adjacent grepped cards by filesCount + filesList', () => {
    const input = [
      msg('grepped', 'Grepped: 3 files', { filesCount: 3, filesList: ['a', 'b', 'c'] }),
      msg('grepped', 'Grepped: 2 files', { filesCount: 2, filesList: ['c', 'd'] }),
    ];
    const out = aggregateChatStatuses(input);
    expect(out).toHaveLength(1);
    // filesList dedup: c appears once.
    expect(out[0].content.metadata?.filesList).toEqual(['a', 'b', 'c', 'd']);
    expect(out[0].content.content).toBe('Grepped: 5 files');
  });

  it('merges adjacent searched_code cards by totalMatches + filesCount', () => {
    const input = [
      msg('searched_code', 'Found: 10 matches in 3 files', { totalMatches: 10, filesCount: 3 }),
      msg('searched_code', 'Found: 5 matches in 2 files', { totalMatches: 5, filesCount: 2 }),
    ];
    const out = aggregateChatStatuses(input);
    expect(out).toHaveLength(1);
    expect(out[0].content.content).toBe('Found: 15 matches in 5 files');
  });

  it('merges adjacent retrieved cards', () => {
    const input = [
      msg('retrieved', 'Retrieved: 3 files from Vector DB', { filesCount: 3, filesList: ['a', 'b', 'c'] }),
      msg('retrieved', 'Retrieved: 2 files from Vector DB', { filesCount: 2, filesList: ['d', 'e'] }),
    ];
    const out = aggregateChatStatuses(input);
    expect(out).toHaveLength(1);
    expect(out[0].content.content).toBe('Retrieved: 5 files from Vector DB');
    expect(out[0].content.metadata?.filesList).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('merges adjacent explored cards', () => {
    const input = [
      msg('explored', 'Explored: 2 files', { filesCount: 2, filesList: ['a', 'b'] }),
      msg('explored', 'Explored: 1 files', { filesCount: 1, filesList: ['c'] }),
    ];
    const out = aggregateChatStatuses(input);
    expect(out).toHaveLength(1);
    expect(out[0].content.content).toBe('Explored: 3 files with uncommitted changes');
  });

  it('does NOT merge across different families (read + listed_files)', () => {
    const input = [
      msg('read', 'Read: a.ts', { filePath: 'a.ts' }),
      msg('listed_files', 'Listed: 2/2 files', { filesCount: 2, totalFiles: 2 }),
    ];
    const out = aggregateChatStatuses(input);
    expect(out).toHaveLength(2);
  });
});

describe('aggregateChatStatuses — originalIndex stability', () => {
  it('propagates the first slot index for React keys', () => {
    const input: MessageContent[] = [
      msg('text', 'hello'),
      msg('read', 'Read: a.ts', { filePath: 'a.ts' }),
      msg('read', 'Read: b.ts', { filePath: 'b.ts' }),
      msg('read', 'Read: c.ts', { filePath: 'c.ts' }),
      msg('text', 'done'),
    ];
    const out = aggregateChatStatuses(input);
    expect(out).toHaveLength(3);
    expect(out[0].originalIndex).toBe(0);
    expect(out[1].originalIndex).toBe(1); // first slot of the read bucket
    expect(out[1].mergedCount).toBe(3);
    expect(out[2].originalIndex).toBe(4);
  });
});

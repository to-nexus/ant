/**
 * compactTurns — read-content preservation (dim-beating-brass RCA).
 *
 * The old compaction summarised cold turns to file PATHS only, dropping
 * read_file CONTENT. Once history passed the threshold the model could no
 * longer see files it had read and re-read them in a loop until it burned the
 * recursion budget. compactTurns now preserves the latest read content of
 * still-relevant files (deduped + staleness-safe).
 *
 * Verifies:
 *   - latest read content of an unmodified file is preserved (not path-only)
 *   - duplicate reads of one path collapse to the LATEST content
 *   - a read followed by an edit/create of the same path is NOT preserved
 *     (staleness-safe — the [file edited] marker is the truth)
 *   - the do-not-re-read directive is present
 */
import { describe, it, expect } from 'vitest';
import { compactTurns } from '../../../src/core/context/compactTurns';
import type { ConversationMessage } from '../../../src/core/context/types';
import type { MessageContentBlock } from '../../../src/core/ports/llm';

function readTurn(id: string, path: string, content: string): ConversationMessage[] {
  const pad = ' padding'.repeat(40); // ensure cold turns are non-trivial in size
  return [
    { role: 'assistant', content: [{ type: 'tool_use', id, name: 'read_file', input: { path } }] as MessageContentBlock[] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, tool_name: 'read_file', content: content + pad }] as MessageContentBlock[] },
  ];
}

function editTurn(id: string, path: string): ConversationMessage[] {
  return [
    { role: 'assistant', content: [{ type: 'tool_use', id, name: 'edit_file', input: { path } }] as MessageContentBlock[] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, tool_name: 'edit_file', content: '[file edited: ' + path + ']' }] as MessageContentBlock[] },
  ];
}

/** Flatten all text out of a compacted message list. */
function allText(messages: ConversationMessage[]): string {
  return messages
    .map(m => {
      if (typeof m.content === 'string') return m.content;
      return (m.content as MessageContentBlock[])
        .map(b => (b.type === 'text' ? b.text : b.type === 'tool_result' && typeof b.content === 'string' ? b.content : ''))
        .join('\n');
    })
    .join('\n');
}

describe('compactTurns — read-content preservation', () => {
  const history: ConversationMessage[] = [
    ...readTurn('u1', 'src/a.ts', 'BODY_A_OLD'),   // first read of A
    ...readTurn('u2', 'src/a.ts', 'BODY_A_NEW'),   // re-read of A → newer content
    ...readTurn('u3', 'src/b.ts', 'BODY_B'),       // B, never modified
    ...readTurn('u4', 'src/c.ts', 'BODY_C'),       // C read…
    ...editTurn('u5', 'src/c.ts'),                 // …then edited → stale
    // hot tail (kept verbatim, not summarised) — forced to 1 turn below
    { role: 'assistant', content: [{ type: 'text', text: 'final hot turn' }] as MessageContentBlock[] },
  ];

  // Force compaction: tiny threshold, hot tail = 1 so turns 1-5 are cold.
  const { compacted, wasCompacted } = compactTurns(history, 50, 1);
  const text = allText(compacted);

  it('actually compacted the cold turns', () => {
    expect(wasCompacted).toBe(true);
    expect(text).toContain('[Auto-compacted:');
  });

  it('preserves the LATEST read content of an unmodified file (dedup to latest)', () => {
    expect(text).toContain('src/a.ts');
    expect(text).toContain('BODY_A_NEW');
    expect(text).not.toContain('BODY_A_OLD'); // older duplicate read collapsed away
    expect(text).toContain('src/b.ts');
    expect(text).toContain('BODY_B');
  });

  it('is staleness-safe: a read followed by an edit of the same path is NOT preserved', () => {
    // The path still appears as a fact / edited marker, but its stale read
    // CONTENT must not be re-injected.
    expect(text).not.toContain('BODY_C');
    expect(text).toContain('[file edited: src/c.ts]');
  });

  it('includes a do-not-re-read directive', () => {
    expect(text.toLowerCase()).toContain('do not call read_file');
  });
});

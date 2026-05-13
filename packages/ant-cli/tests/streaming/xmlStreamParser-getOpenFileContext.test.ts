/**
 * Unit tests for `XMLStreamParser.getOpenFileContext` (safe-braking-eagle C-2).
 *
 * The accessor lets the execute node snapshot the in-flight `<file>` /
 * `<append>` block when an LLM stream cuts off with
 * `stopReason === 'max_tokens'`, so the next round can resume via
 * `<append path="same">` without re-emitting content the disk already has.
 *
 * Contract:
 *   - Returns `null` when no file/append block is open.
 *   - Returns `{ kind: 'file', path, tailContent }` mid-`<file>`.
 *   - Returns `{ kind: 'append', path, tailContent }` mid-`<append>`.
 *   - `tailContent` is bounded — last ~240 chars of file body.
 *   - `tailContent` includes the un-emitted buffer remainder.
 *   - Returns `null` again after the block closes normally.
 */

import { describe, it, expect } from 'vitest';
import { XMLStreamParser } from '../../src/core/streaming/parsers/XMLStreamParser';
import { StreamState } from '../../src/core/streaming/state/StreamState';

function feed(parser: XMLStreamParser, state: StreamState, text: string): void {
  parser.parse({ type: 'text', text } as any, state);
}

describe('XMLStreamParser.getOpenFileContext', () => {
  it('returns null when no file block is open', () => {
    const parser = new XMLStreamParser();
    const state = new StreamState();
    feed(parser, state, 'just some prose with no file tag yet');
    expect(parser.getOpenFileContext()).toBeNull();
  });

  it('captures the open <file> block path mid-stream', () => {
    const parser = new XMLStreamParser();
    const state = new StreamState();
    feed(parser, state, '<file path="codebase/src/big.ts">\n');
    feed(parser, state, 'export const a = 1;\n');
    feed(parser, state, 'export const b = 2;\n');
    const open = parser.getOpenFileContext();
    expect(open).not.toBeNull();
    expect(open!.kind).toBe('file');
    expect(open!.path).toBe('codebase/src/big.ts');
    expect(open!.tailContent).toContain('export const b = 2;');
  });

  it('captures the open <append> block path mid-stream', () => {
    const parser = new XMLStreamParser();
    const state = new StreamState();
    feed(parser, state, '<append path="codebase/src/big.ts">\n');
    feed(parser, state, 'export const c = 3;\n');
    const open = parser.getOpenFileContext();
    expect(open).not.toBeNull();
    expect(open!.kind).toBe('append');
    expect(open!.path).toBe('codebase/src/big.ts');
    expect(open!.tailContent).toContain('export const c = 3;');
  });

  it('caps tailContent to roughly the last ~240 chars', () => {
    const parser = new XMLStreamParser();
    const state = new StreamState();
    feed(parser, state, '<file path="codebase/src/huge.ts">\n');
    // Emit ~3000 chars of complete lines so the rolling tail clamps.
    for (let i = 0; i < 100; i++) {
      feed(parser, state, `// line ${String(i).padStart(3, '0')} ${'x'.repeat(20)}\n`);
    }
    const open = parser.getOpenFileContext();
    expect(open).not.toBeNull();
    expect(open!.tailContent.length).toBeLessThanOrEqual(240);
    // Tail should contain the very last line emitted (line 99).
    expect(open!.tailContent).toContain('line 099');
    // Tail should NOT contain the first line emitted (long since rolled off).
    expect(open!.tailContent).not.toContain('line 000');
  });

  it('returns null again after </file> closes the block', () => {
    const parser = new XMLStreamParser();
    const state = new StreamState();
    feed(parser, state, '<file path="codebase/src/done.ts">\n');
    feed(parser, state, 'export const x = 1;\n</file>\n');
    expect(parser.getOpenFileContext()).toBeNull();
  });

  it('returns null after reset() even mid-file', () => {
    const parser = new XMLStreamParser();
    const state = new StreamState();
    feed(parser, state, '<file path="codebase/src/x.ts">\n');
    feed(parser, state, 'export const y = 2;\n');
    parser.reset();
    expect(parser.getOpenFileContext()).toBeNull();
  });

  it('includes the un-emitted buffer remainder (partial last line) in tailContent', () => {
    const parser = new XMLStreamParser();
    const state = new StreamState();
    feed(parser, state, '<file path="codebase/src/partial.ts">\n');
    // Emit one complete line, then a partial line WITHOUT trailing newline.
    feed(parser, state, 'export const complete = 1;\n');
    feed(parser, state, 'const partial = 42 + ');
    const open = parser.getOpenFileContext();
    expect(open).not.toBeNull();
    // Captures both the emitted line and the un-emitted partial — the LLM
    // sees the actual cut point in the resume hint.
    expect(open!.tailContent).toContain('complete = 1');
    expect(open!.tailContent).toContain('partial = 42 +');
  });
});

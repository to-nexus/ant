/**
 * `<reply>` end-to-end rendering.
 *
 * Locks two layers of the Output Tag Matrix wiring:
 *
 *   1. SpecialTagTransformer recognises `<reply>...</reply>` and
 *      returns the trimmed body as chat text + consumed (still exercised
 *      by post-stream `transformAndStrip` surfaces: plan bodies,
 *      task_response buffers, invoke fallbacks).
 *   2. XMLStreamParser owns the STREAMING path (A14): free text before a
 *      `<reply>` is cut into its own response action, the delimiters are
 *      consumed by the parser, and the body live-streams as plain
 *      response chunks. `insideReply` survives `finalize()` (only
 *      `reset()` clears it), so a `<reply>` opened in one tool round and
 *      closed in a later one renders clean instead of leaking raw tags.
 */

import { describe, it, expect } from 'vitest';
import { SpecialTagTransformer } from '../../src/core/streaming/transformers/SpecialTagTransformer';
import { XMLStreamParser } from '../../src/core/streaming/parsers/XMLStreamParser';
import { StreamState } from '../../src/core/streaming/state/StreamState';

function collectResponses(actions: Array<{ type: string; data: any }>): string {
  return actions
    .filter((a) => a.type === 'response')
    .map((a) => (a.data as { content: string }).content)
    .join('');
}

describe('<reply> tag — SpecialTagTransformer', () => {
  it('extracts body verbatim and consumes the tag', () => {
    const t = new SpecialTagTransformer('en');
    const result = t.transform('<reply>Hello, world.</reply>');
    expect(result.consumed).toBe(true);
    expect(result.text).toBe('Hello, world.');
  });

  it('trims whitespace inside the body', () => {
    const t = new SpecialTagTransformer('en');
    const result = t.transform('<reply>\n  Trimmed.  \n</reply>');
    expect(result.consumed).toBe(true);
    expect(result.text).toBe('Trimmed.');
  });

  it('empty body consumes silently (no chat text emitted)', () => {
    const t = new SpecialTagTransformer('en');
    const result = t.transform('<reply>   </reply>');
    expect(result.consumed).toBe(true);
    expect(result.text).toBeUndefined();
  });

  it('preserves multi-line markdown formatting in the body', () => {
    const t = new SpecialTagTransformer('en');
    const body = '**Bold**\n\n- one\n- two';
    const result = t.transform(`<reply>${body}</reply>`);
    expect(result.text).toBe(body);
  });

  it('non-reply content falls through unchanged (consumed=false)', () => {
    const t = new SpecialTagTransformer('en');
    const result = t.transform('plain text without any tag');
    expect(result.consumed).toBe(false);
  });
});

describe('<reply> tag — XMLStreamParser streaming path (A14)', () => {
  it('cuts free-text before the tag, consumes the delimiters, streams the body', () => {
    const parser = new XMLStreamParser();
    const state = new StreamState();
    const incremental = parser.parse(
      { type: 'text', text: 'Here is my answer:\n<reply>Body.</reply>' },
      state,
    );
    const merged = collectResponses([...incremental, ...parser.finalize()]);

    expect(merged).toContain('Here is my answer:');
    expect(merged).toContain('Body.');
    expect(merged).not.toContain('<reply>');
    expect(merged).not.toContain('</reply>');
  });

  it('handles delimiters split across chunk boundaries', () => {
    const parser = new XMLStreamParser();
    const state = new StreamState();
    const actions = [
      ...parser.parse({ type: 'text', text: '<rep' }, state),
      ...parser.parse({ type: 'text', text: 'ly>Split body' }, state),
      ...parser.parse({ type: 'text', text: ' continues</re' }, state),
      ...parser.parse({ type: 'text', text: 'ply>' }, state),
      ...parser.finalize(),
    ];
    const merged = collectResponses(actions);

    expect(merged).toBe('Split body continues');
  });

  it('a <reply> opened in round 1 and closed in round 2 renders clean across finalize()', () => {
    // Turn-persistent parser (universal agent loop): round 1 ends with tool
    // calls — the agent node does NOT finalize mid-turn, but even the state
    // must survive a flush: only reset() clears insideReply.
    const parser = new XMLStreamParser();
    const state = new StreamState();

    const round1 = parser.parse(
      { type: 'text', text: '<reply>Checking the incident list.\n' },
      state,
    );
    // Round boundary: tool executes; round 2 streams the closing tag.
    const round2 = [
      ...parser.parse({ type: 'text', text: 'Found 3 open incidents.</reply>' }, state),
      ...parser.finalize(),
    ];
    const merged = collectResponses([...round1, ...round2]);

    expect(merged).toContain('Checking the incident list.');
    expect(merged).toContain('Found 3 open incidents.');
    expect(merged).not.toContain('<reply>');
    expect(merged).not.toContain('</reply>');
  });

  it('an unterminated <reply> body still flushes as text on finalize', () => {
    const parser = new XMLStreamParser();
    const state = new StreamState();
    const actions = [
      ...parser.parse({ type: 'text', text: '<reply>Tail without close' }, state),
      ...parser.finalize(),
    ];
    const merged = collectResponses(actions);

    expect(merged).toContain('Tail without close');
    expect(merged).not.toContain('<reply>');
  });

  it('reset() clears insideReply (fresh stream after retry does not swallow text)', () => {
    const parser = new XMLStreamParser();
    const state = new StreamState();
    parser.parse({ type: 'text', text: '<reply>partial' }, state);
    parser.reset();

    const actions = [
      ...parser.parse({ type: 'text', text: 'plain text after reset\n' }, state),
      ...parser.finalize(),
    ];
    expect(collectResponses(actions)).toContain('plain text after reset');
  });
});

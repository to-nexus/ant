/**
 * `<reply>` end-to-end rendering — Phase 3 W1 pilot.
 *
 * Locks two layers of the Output Tag Matrix wiring:
 *
 *   1. SpecialTagTransformer recognises `<reply>...</reply>` and
 *      returns the trimmed body as chat text + consumed.
 *   2. XMLStreamParser cuts free text BEFORE a `<reply>` tag (so that
 *      a model that emits prose-then-tag doesn't lose the prose) and
 *      then the reply tag itself flows through to the transformer.
 *
 * Phase 4 will rewire this through OutputTagRegistry directly; the
 * test continues to be the contract.
 */

import { describe, it, expect } from 'vitest';
import { SpecialTagTransformer } from '../../src/core/streaming/transformers/SpecialTagTransformer';
import { XMLStreamParser } from '../../src/core/streaming/parsers/XMLStreamParser';

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

describe('<reply> tag — XMLStreamParser interaction with free text', () => {
  it('cuts free-text PRECEDING a <reply> open tag into a separate response action', async () => {
    const { StreamState } = await import(
      '../../src/core/streaming/state/StreamState'
    );
    const parser = new XMLStreamParser();
    const state = new StreamState();
    const incremental = parser.parse(
      { type: 'text', text: 'Here is my answer:\n<reply>Body.</reply>' },
      state,
    );
    const finalActions = parser.finalize();

    const responseTexts = [...incremental, ...finalActions]
      .filter((a) => a.type === 'response')
      .map((a) => (a.data as { content: string }).content);
    const merged = responseTexts.join('');

    // 1. The free-text prefix must reach a `response` action — the
    //    lookahead in section 21 of the parser is what guarantees this.
    expect(merged).toContain('Here is my answer:');
    // 2. The full `<reply>...</reply>` body must also reach a response
    //    chunk (whether emitted incrementally or at finalize). The
    //    SpecialTagTransformer downstream extracts the body — that is
    //    locked by the transformer-level cases above.
    expect(merged).toContain('<reply>Body.</reply>');
  });
});

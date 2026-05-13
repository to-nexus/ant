/**
 * Unit tests for `buildMaxTokensResumeHint` (safe-braking-eagle C-3).
 *
 * The helper composes the one-shot user-content paragraph injected into
 * the next execute round after a `max_tokens` truncation cut off a
 * `<file>` / `<append>` block mid-stream. Verifies the LLM-facing wording
 * carries:
 *   - the open block's kind + path,
 *   - the verbatim tail (so the LLM can locate the resume point on disk),
 *   - guidance to use `<append>` instead of re-emitting,
 *   - escaping for backticks in the tail so the fenced code block stays
 *     well-formed.
 */

import { describe, it, expect } from 'vitest';
import { buildMaxTokensResumeHint } from '../../src/agents/architect/graph/code/nodes/execute/buildMessages';

describe('buildMaxTokensResumeHint', () => {
  it('names the open <file> block path and includes the verbatim tail', () => {
    const hint = buildMaxTokensResumeHint({
      kind: 'file',
      path: 'codebase/src/data/tweets.ts',
      tailContent: 'export const TWEET_42: Tweet = { id: "t042",',
    });
    expect(hint).toMatch(/TRUNCATED MID-FILE/);
    expect(hint).toContain('<file path="codebase/src/data/tweets.ts">');
    expect(hint).toContain('export const TWEET_42: Tweet = { id: "t042",');
    expect(hint).toContain('<append path="codebase/src/data/tweets.ts">');
  });

  it('uses <append> kind in the truncated-block reference when the open block was <append>', () => {
    const hint = buildMaxTokensResumeHint({
      kind: 'append',
      path: 'codebase/src/data/users.ts',
      tailContent: '// continuing user list\n',
    });
    expect(hint).toContain('<append path="codebase/src/data/users.ts">');
    // The instruction to resume always uses <append> regardless of which
    // tag was open — append is the only safe continuation.
    expect(hint).toMatch(/Resume by emitting `<append path="codebase\/src\/data\/users\.ts">/);
  });

  it('escapes backticks in tailContent so the fenced preview stays well-formed', () => {
    const hint = buildMaxTokensResumeHint({
      kind: 'file',
      path: 'codebase/src/foo.ts',
      tailContent: 'const x = `template ${value} literal`;',
    });
    // Tail backticks must be escaped — otherwise the ```...``` preview block
    // closes early at the first inner backtick.
    expect(hint).toContain('\\`template ${value} literal\\`;');
  });

  it('reports the captured tail length (so the model knows how much was preserved)', () => {
    const tail = 'x'.repeat(123);
    const hint = buildMaxTokensResumeHint({
      kind: 'file',
      path: 'codebase/src/foo.ts',
      tailContent: tail,
    });
    expect(hint).toContain('`123` characters');
  });

  it('instructs the model not to re-emit content already on disk', () => {
    const hint = buildMaxTokensResumeHint({
      kind: 'file',
      path: 'codebase/x.ts',
      tailContent: 'tail',
    });
    // The instruction wraps across a newline in the rendered paragraph —
    // tolerate any whitespace between "content" and "that is already".
    expect(hint).toMatch(/Do NOT re-emit any content\s+that is already on disk/);
    expect(hint).toMatch(/<done>false<\/done>/);
  });
});

/**
 * Unit tests for `buildMaxTokensResumeHint` (safe-braking-eagle C-3, ported
 * to the tool-call authoring protocol).
 *
 * The helper composes the one-shot user-content paragraph injected into
 * the next execute round after a `max_tokens` truncation cut off a
 * `create_file` / `append_file` tool call mid-arguments. A truncated tool
 * call NEVER executes, so — unlike the retired tag channel's buffered
 * partial — nothing reached disk. Verifies the LLM-facing wording carries:
 *   - the truncated call's tool name + path,
 *   - kind 'file' → re-issue `create_file` chunked (opening chunk under the
 *     ceiling, then `append_file` until complete),
 *   - kind 'append' → re-issue `append_file` from the file's current end,
 *   - the verbatim tail as context only, explicitly marked NOT on disk,
 *   - escaping for backticks in the tail so the fenced code block stays
 *     well-formed.
 */

import { describe, it, expect } from 'vitest';
import { buildMaxTokensResumeHint } from '../../src/agents/architect/graph/code/nodes/execute/buildMessages';

describe('buildMaxTokensResumeHint', () => {
  it('kind "file": names the truncated create_file call and instructs a chunked re-issue', () => {
    const hint = buildMaxTokensResumeHint({
      kind: 'file',
      path: 'codebase/src/data/tweets.ts',
      tailContent: 'export const TWEET_42: Tweet = { id: "t042",',
    });
    expect(hint).toMatch(/TRUNCATED MID-WRITE — RESUME REQUIRED/);
    expect(hint).toContain('create_file call for `codebase/src/data/tweets.ts`');
    // A truncated tool call never executes — the file must be declared absent.
    expect(hint).toContain('A truncated tool call never executes.');
    expect(hint).toContain('The file was NOT created. Re-issue `create_file`');
    // Chunking guidance: opening chunk under the ceiling, then append_file.
    expect(hint).toMatch(/continue with `append_file`\s*\ncalls until the file is complete/);
    expect(hint).toContain('export const TWEET_42: Tweet = { id: "t042",');
  });

  it('kind "append": instructs re-issuing append_file from the file\'s current end', () => {
    const hint = buildMaxTokensResumeHint({
      kind: 'append',
      path: 'codebase/src/data/users.ts',
      tailContent: '// continuing user list\n',
    });
    expect(hint).toContain('append_file call for `codebase/src/data/users.ts`');
    // The target EXISTS without the lost chunk — resume appends at the
    // current end instead of recreating the file.
    expect(hint).toContain('The target file exists WITHOUT the lost chunk.');
    expect(hint).toMatch(/Re-issue `append_file` for\s*\n`codebase\/src\/data\/users\.ts` starting from the file's current end/);
    expect(hint).not.toContain('Re-issue `create_file`');
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

  it('marks the tail as context only — NOT on disk (nothing from a truncated call executes)', () => {
    const hint = buildMaxTokensResumeHint({
      kind: 'file',
      path: 'codebase/x.ts',
      tailContent: 'tail',
    });
    // The tag-channel predecessor salvaged the partial to disk and told the
    // model not to re-emit it; the tool channel is the opposite contract —
    // the tail exists only in the hint and MUST be re-emitted.
    expect(hint).toMatch(/context only — they are NOT on disk/);
  });
});

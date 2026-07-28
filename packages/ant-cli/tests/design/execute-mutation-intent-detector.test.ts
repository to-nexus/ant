/**
 * R5 — turn-level artifact-mutation detection feeding `_pendingDoneCheck`.
 *
 * The execute node sets `_pendingDoneCheck = true` when a turn LANDED an
 * artifact mutation but the LLM did NOT emit `<done>true</done>`. Two
 * channels, both success-based:
 *
 *   - XML channel (same turn): `files` holds <file>/<append>/<edit>/<delete>
 *     writes FileRenderer already landed on disk — intent == success.
 *   - Tool channel (next turn): successful edit_file/create_file/delete_file
 *     sideEffects fold into `_turnToolWrites` (tool node), and the execute
 *     node upgrades `_pendingDoneCheck` from it at round start.
 *
 * Pending tool calls are deliberately NOT counted: intent-based counting
 * forged the self-check after every FAILED write — sharp-baking-bride RCA:
 * 3× `edit_file` on a nonexistent target each injected "the previous turn
 * updated the artifact" while suppressing the correct <file>-tag deadline
 * hint. (mkdir was the earlier seat of the same class — oat-judging-mound.)
 *
 * The helper is `turnHadArtifactMutationIntent` in `execute/index.ts`. It is
 * module-private — the truth table is re-derived here with the same path
 * conventions, and a STATIC lock below pins the source-level contract so the
 * mirror cannot silently diverge.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const CODEBASE_LIKE = (p: string): boolean => p === 'codebase' || p.startsWith('codebase/');

function turnHadArtifactMutationIntent(
  files: Array<{ path: string }>,
): boolean {
  return files.some(f => f.path && !CODEBASE_LIKE(f.path));
}

describe('turnHadArtifactMutationIntent (XML channel — success-based by construction)', () => {
  it('false when no files were rendered', () => {
    expect(turnHadArtifactMutationIntent([])).toBe(false);
  });

  it('true when an XML <file> on an artifact path was rendered', () => {
    expect(turnHadArtifactMutationIntent([{ path: 'architecture/spec/foo.md' }])).toBe(true);
  });

  it('true when an XML <append> on plan/ was rendered', () => {
    expect(turnHadArtifactMutationIntent([{ path: 'plan/prd.md' }])).toBe(true);
  });

  it('false when only codebase/ paths appear in `files` (gate already rejected upstream)', () => {
    expect(turnHadArtifactMutationIntent([{ path: 'codebase/src/foo.ts' }])).toBe(false);
  });

  it('true when mixed codebase + artifact paths were rendered', () => {
    expect(
      turnHadArtifactMutationIntent([
        { path: 'codebase/src/foo.ts' },
        { path: 'architecture/system/be-system-main.md' },
      ]),
    ).toBe(true);
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// STATIC — pin the source-level contract of the R5 gate so the mirrored
// predicate above and the real module-private helper cannot diverge:
//   1. the detector no longer inspects pending tool calls (intent),
//   2. the tool channel enters via the success-based `_turnToolWrites`
//      round-start upgrade.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('execute node R5 gate — success-based source contract', () => {
  const source = readFileSync(
    resolve(__dirname, '../../src/agents/architect/graph/design/nodes/execute/index.ts'),
    'utf-8',
  );

  it('the detector takes files only — no pending-tool-call intent parameter', () => {
    const signature = source.match(/function turnHadArtifactMutationIntent\(([\s\S]*?)\)/);
    expect(signature, 'turnHadArtifactMutationIntent must exist').toBeTruthy();
    expect(signature![1]).not.toContain('pendingToolCalls');
  });

  it('no intent-based ARTIFACT_MUTATE_TOOLS set remains in the execute node', () => {
    expect(source).not.toContain('ARTIFACT_MUTATE_TOOLS');
  });

  it('the tool channel upgrades _pendingDoneCheck from the success-based _turnToolWrites', () => {
    expect(source).toMatch(
      /_pendingDoneCheck && \(state\._turnToolWrites \|\| 0\) > 0/,
    );
  });
});

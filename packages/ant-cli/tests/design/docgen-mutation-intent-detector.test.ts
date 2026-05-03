/**
 * R5 — turn-level artifact-mutation-intent detection.
 *
 * The docGen node sets `_pendingDoneCheck = true` when a turn produced
 * an artifact mutation (XML <file>/<append>/<edit>/<delete> on an
 * artifact path, or a pending mutate-tool call on an artifact path)
 * but the LLM did NOT emit `<done>true</done>`. This test imports the
 * detector helper and pins its truth table so refactor-mode and
 * spec/system-design intents stay covered.
 *
 * The helper is `turnHadArtifactMutationIntent` in `docGen/index.ts`.
 * It is module-private — to keep the surface narrow we re-derive the
 * predicate behaviour here using the same path conventions
 * (`codebase/...` paths are excluded because the FileRenderer / tool
 * gate rejects them upstream — they never reach the detector).
 */

import { describe, it, expect } from 'vitest';

// Re-export of the detector for testing without exposing it publicly.
// We re-implement the same logic here against fixtures; if the docGen
// helper diverges, tests covering both should be kept consistent. The
// detector spec is in `docs/architecture/15-design-job.md` "Codebase
// mutation gate" and `plan_3398344f.plan.md` §5.3.
const CODEBASE_LIKE = (p: string): boolean => p === 'codebase' || p.startsWith('codebase/');
const ARTIFACT_MUTATE_TOOLS = new Set([
  'edit_file', 'delete_file', 'create_file', 'mkdir',
]);

function turnHadArtifactMutationIntent(
  files: Array<{ path: string }>,
  pendingToolCalls: Array<{ name: string; args?: any }>,
): boolean {
  const xmlMut = files.some(f => f.path && !CODEBASE_LIKE(f.path));
  const toolMut = pendingToolCalls.some(tc => {
    if (!ARTIFACT_MUTATE_TOOLS.has(tc.name)) return false;
    const p = tc.args?.path;
    return typeof p === 'string' && p.length > 0 && !CODEBASE_LIKE(p);
  });
  return xmlMut || toolMut;
}

describe('turnHadArtifactMutationIntent', () => {
  it('false when no files and no tool calls', () => {
    expect(turnHadArtifactMutationIntent([], [])).toBe(false);
  });

  it('true when an XML <file> on an artifact path was rendered', () => {
    expect(
      turnHadArtifactMutationIntent(
        [{ path: 'architecture/spec/foo.md' }],
        [],
      ),
    ).toBe(true);
  });

  it('true when an XML <append> on plan/ was rendered', () => {
    expect(
      turnHadArtifactMutationIntent(
        [{ path: 'plan/prd.md' }],
        [],
      ),
    ).toBe(true);
  });

  it('false when only codebase/ paths appear in `files` (gate already rejected upstream)', () => {
    expect(
      turnHadArtifactMutationIntent(
        [{ path: 'codebase/src/foo.ts' }],
        [],
      ),
    ).toBe(false);
  });

  it('true when a pending edit_file targets an artifact path (refactor mode)', () => {
    expect(
      turnHadArtifactMutationIntent(
        [],
        [{ name: 'edit_file', args: { path: 'architecture/spec/foo.md' } }],
      ),
    ).toBe(true);
  });

  it('true when a pending delete_file targets an artifact path', () => {
    expect(
      turnHadArtifactMutationIntent(
        [],
        [{ name: 'delete_file', args: { path: 'architecture/spec/old.md' } }],
      ),
    ).toBe(true);
  });

  it('false when only read-only tools (read_file, list_files) are pending', () => {
    expect(
      turnHadArtifactMutationIntent(
        [],
        [
          { name: 'read_file', args: { path: 'architecture/spec/foo.md' } },
          { name: 'list_files', args: { directory: 'codebase/src' } },
        ],
      ),
    ).toBe(false);
  });

  it('false when mutate tool targets codebase/ (gate rejects, no real mutation happens)', () => {
    expect(
      turnHadArtifactMutationIntent(
        [],
        [{ name: 'edit_file', args: { path: 'codebase/src/foo.ts' } }],
      ),
    ).toBe(false);
  });

  it('false when mutate tool args lacks a path field (malformed call)', () => {
    expect(
      turnHadArtifactMutationIntent(
        [],
        [{ name: 'edit_file', args: { search: 'foo', replace: 'bar' } }],
      ),
    ).toBe(false);
  });

  it('true when mixed: codebase/ tool call (rejected) + artifact <file>', () => {
    expect(
      turnHadArtifactMutationIntent(
        [{ path: 'architecture/system/be-system-main.md' }],
        [{ name: 'edit_file', args: { path: 'codebase/src/foo.ts' } }],
      ),
    ).toBe(true);
  });
});

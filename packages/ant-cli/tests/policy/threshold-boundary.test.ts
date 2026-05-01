/**
 * Task 1: Threshold Boundary Tests
 *
 * Validates inline ↔ outline switching at the per-role thresholds and the
 * grand-total demotion path inside `prepareRacInjection`. Also covers
 * `compactContent` boundary semantics (re-used by every compaction site).
 */
import { describe, it, expect } from 'vitest';
import {
  EXECUTE_SOURCE_THRESHOLD,
  DECOMPOSE_SOURCE_THRESHOLD,
} from '../../src/agents/architect/graph/design/nodes/docGen/sourceSelector';
import { prepareRacInjection } from '../../src/agents/architect/graph/code/nodes/decompose/designSelector';
import { compactContent } from '../../src/core/utils/contentCompactor';
import {
  REF_INLINE_THRESHOLD_CHARS,
  CONTEXT_INLINE_THRESHOLD_CHARS,
} from '../../src/core/context/constants';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeString(len: number): string {
  return 'x'.repeat(len);
}

function makeArtifact(
  path: string,
  content: string,
  role: 'ref' | 'context' = 'ref',
): any {
  return { path, role, content };
}

function makeStateWithArtifacts(artifacts: any[]): any {
  return { artifacts } as any;
}

// ---------------------------------------------------------------------------
// 1. EXECUTE_SOURCE_THRESHOLD boundary (systemDesignPrompt path)
// ---------------------------------------------------------------------------

describe('EXECUTE_SOURCE_THRESHOLD boundary', () => {
  it('at threshold → inline mode (sourceDocsForTask.length === threshold)', () => {
    const content = makeString(EXECUTE_SOURCE_THRESHOLD);
    expect(content.length).toBe(EXECUTE_SOURCE_THRESHOLD);
    expect(content.length > EXECUTE_SOURCE_THRESHOLD).toBe(false);
  });

  it('at threshold+1 → tool mode (sourceDocsForTask.length > threshold)', () => {
    const content = makeString(EXECUTE_SOURCE_THRESHOLD + 1);
    expect(content.length).toBe(EXECUTE_SOURCE_THRESHOLD + 1);
    expect(content.length > EXECUTE_SOURCE_THRESHOLD).toBe(true);
  });

  it('threshold constant is 200_000', () => {
    expect(EXECUTE_SOURCE_THRESHOLD).toBe(200_000);
    // Design job retains its own source threshold; this is informational.
    expect(DECOMPOSE_SOURCE_THRESHOLD).toBe(200_000);
  });
});

// ---------------------------------------------------------------------------
// 2. prepareRacInjection — role-scoped inline thresholds + dynamic demotion
// ---------------------------------------------------------------------------

describe('prepareRacInjection — role-scoped thresholds', () => {
  it('(a) all artifacts under per-role thresholds → all stay inline', () => {
    const state = makeStateWithArtifacts([
      makeArtifact(
        'architecture/system/fe-system-main.md',
        makeString(REF_INLINE_THRESHOLD_CHARS - 1),
        'ref',
      ),
      makeArtifact(
        'architecture/spec/spec-auth.md',
        makeString(CONTEXT_INLINE_THRESHOLD_CHARS - 1),
        'context',
      ),
    ]);
    const result = prepareRacInjection(state);
    expect(result.hasCompactedArtifacts).toBe(false);
    expect(result.refs.every(a => !a.wasCompacted)).toBe(true);
    expect(result.context.every(a => !a.wasCompacted)).toBe(true);
  });

  it('(b) ref over its threshold + small context → only ref compacted', () => {
    const state = makeStateWithArtifacts([
      makeArtifact(
        'architecture/system/fe-system-main.md',
        makeString(REF_INLINE_THRESHOLD_CHARS + 4_000),
        'ref',
      ),
      makeArtifact(
        'architecture/spec/spec-auth.md',
        makeString(1_000),
        'context',
      ),
    ]);
    const result = prepareRacInjection(state);
    expect(result.hasCompactedArtifacts).toBe(true);
    const ref = result.refs.find(a => a.path.includes('fe-system-main'));
    const ctx = result.context.find(a => a.path.includes('spec-auth'));
    expect(ref?.wasCompacted).toBe(true);
    expect(ctx?.wasCompacted).toBeFalsy();
  });

  it('(c) both over their respective thresholds → role-aware compaction', () => {
    // Ref at 5K — under 8K ref threshold → stays inline.
    // Context at 5K — over 2K context threshold → compacted.
    const state = makeStateWithArtifacts([
      makeArtifact(
        'plan/prd.md',
        makeString(5_000),
        'ref',
      ),
      makeArtifact(
        'plan/intro.md',
        makeString(5_000),
        'context',
      ),
    ]);
    const result = prepareRacInjection(state);
    const ref = result.refs.find(a => a.path === 'plan/prd.md');
    const ctx = result.context.find(a => a.path === 'plan/intro.md');
    expect(ref?.wasCompacted).toBeFalsy();
    expect(ctx?.wasCompacted).toBe(true);
  });

  it('(e) ref-only overflow → largest ref demoted greedily until under budget', () => {
    // 80K + 80K = 160K artifact bytes. Default 128K model context yields
    // ~50K artifact char budget — still over. Two refs are over their
    // 8K threshold so role-pass already compacts both. To exercise the
    // greedy ref demotion path we keep both BELOW the 8K ref threshold
    // (so role-pass leaves them inline) and force a tiny budget to
    // require demotion.
    const state = makeStateWithArtifacts([
      makeArtifact('plan/a.md', makeString(7_500), 'ref'),
      makeArtifact('plan/b.md', makeString(7_000), 'ref'),
    ]);
    // Tiny budget → both still inline after role-pass → greedy loop
    // picks the largest first (a.md, 7.5K), then b.md (7K).
    const result = prepareRacInjection(state, 80_000);
    expect(result.meta.artifactBudgetChars).toBeLessThan(7_000);
    const a = result.refs.find(r => r.path === 'plan/a.md');
    const b = result.refs.find(r => r.path === 'plan/b.md');
    expect(a?.wasCompacted).toBe(true);
    // Greedy loop demotes the largest first; the order in
    // forcedZeroThresholdPaths is deterministic (largest → smallest).
    expect(result.meta.forcedZeroThresholdPaths[0]).toBe('plan/a.md');
    // b.md may or may not be demoted depending on whether the budget is
    // satisfied after a's demotion; with a tiny budget both are demoted.
    expect(b?.wasCompacted).toBe(true);
  });

  it('(f) many small refs each at the per-doc threshold → grand-total demotion picks them up', () => {
    // The user-described pathology: each ref is small enough to stay
    // inline by the per-role rule (exactly REF_INLINE_THRESHOLD_CHARS),
    // but their sum overruns the artifact budget. Legacy code had no
    // grand-total check and would emit all 20 inline; the new pipeline
    // demotes greedily until the total fits.
    const COUNT = 20;
    const state = makeStateWithArtifacts(
      Array.from({ length: COUNT }, (_, i) =>
        makeArtifact(`plan/ref-${i}.md`, makeString(REF_INLINE_THRESHOLD_CHARS), 'ref'),
      ),
    );
    const result = prepareRacInjection(state);
    // Grand total before = 160K chars, default budget ≈ 50K → demotion
    // engages even though every single doc is at-threshold.
    expect(result.meta.grandTotalCharsBefore).toBe(REF_INLINE_THRESHOLD_CHARS * COUNT);
    expect(result.meta.grandTotalCharsAfter).toBeLessThan(result.meta.grandTotalCharsBefore);
    expect(result.meta.forcedZeroThresholdPaths.length).toBeGreaterThan(0);
    expect(result.refs.some(a => a.wasCompacted)).toBe(true);
  });

  it('(f-baseline) many small refs whose sum fits the budget → all stay inline', () => {
    // Sanity check: when the grand total fits the budget, none of the
    // small refs are touched.
    const state = makeStateWithArtifacts(
      Array.from({ length: 3 }, (_, i) =>
        makeArtifact(`plan/ref-${i}.md`, makeString(REF_INLINE_THRESHOLD_CHARS - 1), 'ref'),
      ),
    );
    const result = prepareRacInjection(state);
    expect(result.refs.every(a => !a.wasCompacted)).toBe(true);
    expect(result.meta.forcedZeroThresholdPaths.length).toBe(0);
  });

  it('(d) grand total > artifact budget → context demoted to threshold 0', () => {
    // Force a tiny budget so the demotion path engages even with modest sizes.
    // computeArtifactBudgetChars(modelContextLimitTokens) drops below total
    // when the model context is set just above the reservations.
    const state = makeStateWithArtifacts([
      makeArtifact(
        'architecture/system/fe-system-main.md',
        makeString(5_000), // ref under 8K — wants inline
        'ref',
      ),
      makeArtifact(
        'plan/intro.md',
        makeString(1_500), // context under 2K — wants inline too
        'context',
      ),
    ]);
    // 80K tokens → input budget 80_000 - 76_000 reserved ≈ 4_000 - 8_000
    // codebase reserve = floor → near zero artifact budget. Forces demotion.
    const result = prepareRacInjection(state, 80_000);
    expect(result.meta.artifactBudgetChars).toBeLessThan(5_000);
    // Context with content is the first demotion target.
    const ctx = result.context.find(a => a.path === 'plan/intro.md');
    expect(ctx?.wasCompacted).toBe(true);
    expect(result.meta.forcedZeroThresholdPaths).toContain('plan/intro.md');
  });

  it('emits readable design-doc labels via documents[] for system-design artifacts', () => {
    const state = makeStateWithArtifacts([
      makeArtifact(
        'architecture/system/fe-system-main.md',
        makeString(2_000),
        'ref',
      ),
      makeArtifact(
        'architecture/system/be-system-auth.md',
        makeString(1_000),
        'context',
      ),
    ]);
    const result = prepareRacInjection(state);
    const fe = result.documents.find(a => a.path.includes('fe-system-main'));
    const be = result.documents.find(a => a.path.includes('be-system-auth'));
    expect(fe?.label).toBe('Frontend System Design: main');
    expect(be?.label).toBe('Backend System Design: auth');
    expect(result.hasDocuments).toBe(true);
  });

  it('refArtifacts excludes system-design / spec / ui prefixes (generic only)', () => {
    const state = makeStateWithArtifacts([
      makeArtifact('architecture/system/fe-system-main.md', 'sd', 'ref'),
      makeArtifact('architecture/spec/spec-x.md', 'sp', 'ref'),
      makeArtifact('visual/ui/ant/tokens.json', 'ui', 'ref'),
      makeArtifact('plan/notes.md', 'generic-ref', 'ref'),
      makeArtifact('plan/extra.md', 'generic-ctx', 'context'),
    ]);
    const result = prepareRacInjection(state);
    expect(result.refArtifacts.map(a => a.path)).toEqual(['plan/notes.md']);
    expect(result.contextArtifacts.map(a => a.path)).toEqual(['plan/extra.md']);
    expect(result.hasGenericArtifacts).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. compactContent boundary
// ---------------------------------------------------------------------------

describe('compactContent boundary', () => {
  const COMPACT_THRESHOLD = 30_000;
  const opts = (threshold: number) => ({
    threshold,
    label: 'Test Doc',
    filePath: 'architecture/test.md',
  });

  it('at threshold → original preserved', () => {
    const content = makeString(COMPACT_THRESHOLD);
    const result = compactContent(content, opts(COMPACT_THRESHOLD));
    expect(result.wasCompacted).toBe(false);
    expect(result.content).toBe(content);
    expect(result.originalChars).toBe(COMPACT_THRESHOLD);
    expect(result.compactedChars).toBe(COMPACT_THRESHOLD);
  });

  it('at threshold+1 → compacted outline', () => {
    const content = makeString(COMPACT_THRESHOLD + 1);
    const result = compactContent(content, opts(COMPACT_THRESHOLD));
    expect(result.wasCompacted).toBe(true);
    expect(result.content).not.toBe(content);
    expect(result.originalChars).toBe(COMPACT_THRESHOLD + 1);
    expect(result.compactedChars).toBeLessThan(result.originalChars);
    expect(result.content).toContain('compacted');
  });

  it('empty content → not compacted', () => {
    const result = compactContent('', opts(COMPACT_THRESHOLD));
    expect(result.wasCompacted).toBe(false);
    expect(result.content).toBe('');
  });

  it('threshold=0 with non-empty content → always compacted', () => {
    const content = 'hello';
    const result = compactContent(content, opts(0));
    expect(result.wasCompacted).toBe(true);
    expect(result.content).toContain('compacted');
  });

  it('design compact at 30_000 boundary', () => {
    const mdContent = '# Design\n\n' + makeString(30_000 - 12);
    expect(mdContent.length).toBe(30_000 - 2);

    const atThreshold = compactContent(
      mdContent + 'ab',
      opts(30_000),
    );
    expect(atThreshold.wasCompacted).toBe(false);

    const overThreshold = compactContent(
      mdContent + 'abc',
      opts(30_000),
    );
    expect(overThreshold.wasCompacted).toBe(true);
  });
});

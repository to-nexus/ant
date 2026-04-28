/**
 * Decompose Role-Based Context — Invariant Test (F1 follow-up).
 *
 * Pins the (γ) refactor's contract: the three decompose nodes
 * (systemDesign / uiDesign / gameArtDesign) MUST funnel their
 * source/previous-design/directive injection through the shared
 * `buildDecomposeContext` helper + `input-context` partial so the
 * `role='ref' | 'context'` provenance assigned by
 * `loadResolvedArtifacts` survives into the decompose prompt.
 *
 * Two layers are pinned:
 *
 *  - Static (template / partial structure)  — no Handlebars rendering needed.
 *  - Behavioural (helper output for 4 RAC modes)  — explicit-only-ref,
 *    explicit-with-context-demote, infer-default, infer-additive.
 *    These mirror the pipeline split in
 *    `packages/ant-shared/src/rac.ts:583-613` (`mergeWithMetadata`)
 *    and `packages/ant-cli/src/agents/common/graph/loadDocumentsForRAC.ts`
 *    so the partial output reflects the role each artifact arrived
 *    with at the RAC boundary.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ResolvedArtifact } from '@ant/shared';
import { ArtifactPoolView } from '../src/core/artifact/ArtifactPipeline';
import { buildDecomposeContext } from '../src/agents/architect/graph/design/nodes/decompose/buildDecomposeContext';

// ──────────────────────────────────────────────────────────────────────
// Static — template / partial structure
// ──────────────────────────────────────────────────────────────────────

const TEMPLATES_ROOT = path.resolve(__dirname, '../src/core/prompt/templates');

function read(rel: string): string {
  return fs.readFileSync(path.join(TEMPLATES_ROOT, rel), 'utf-8');
}

const PARTIAL_PATH = 'jobs/design/nodes/decompose/shared/input-context.md';
const BASE_PATHS = [
  'jobs/design/nodes/decompose/variants/system-design/base.md',
  'jobs/design/nodes/decompose/variants/ui-design-by-desc/base.md',
  'jobs/design/nodes/decompose/variants/ui-design-by-figma/base.md',
  'jobs/design/nodes/decompose/variants/game-art-design-by-desc/base.md',
  'jobs/design/nodes/decompose/variants/game-art-design-by-figma/base.md',
];

describe('Decompose role-based context — template / partial structure', () => {
  it('shared/input-context.md exists and emits role-aware blocks', () => {
    const src = read(PARTIAL_PATH);
    expect(src).toMatch(/role="ref"/);
    expect(src).toMatch(/role="context"/);
    expect(src).toMatch(/<sources/);
    expect(src).toMatch(/<previous-design/);
    expect(src).toMatch(/<artifact role="ref"/);
    expect(src).toMatch(/<artifact role="context"/);
    expect(src).toMatch(/<directive>/);
    // Must reference documentName so it can render PRD / GDD per domain.
    expect(src).toMatch(/\{\{documentName\}\}/);
    // Must reflect the BOTH-roles-present authority precedence rule —
    // if the user demoted an artifact to context, ref wins.
    expect(src).toMatch(/authoritative/);
  });

  it('all 5 decompose base templates call the shared input-context partial', () => {
    for (const rel of BASE_PATHS) {
      const src = read(rel);
      expect(
        src,
        `${rel} should call the shared input-context partial`,
      ).toMatch(
        /\{\{>\s*jobs\/design\/nodes\/decompose\/shared\/input-context/,
      );
      // documentName slot must appear so PRD/GDD rendering follows the
      // workspace domain instead of the legacy "PRD:" hard-code.
      expect(
        src,
        `${rel} should consume {{documentName}}`,
      ).toMatch(/\{\{documentName\}\}/);
    }
  });

  it('legacy variable injections {{spec}} / {{uiContext}} / {{directiveContext}} are removed from all 5 base templates', () => {
    for (const rel of BASE_PATHS) {
      const src = read(rel);
      expect(src, `${rel} must not retain {{spec}}`).not.toMatch(/\{\{\{?spec\}\}\}?/);
      expect(src, `${rel} must not retain {{uiContext}}`).not.toMatch(
        /\{\{\{?uiContext\}\}\}?/,
      );
      expect(src, `${rel} must not retain {{directiveContext}}`).not.toMatch(
        /\{\{\{?directiveContext\}\}\}?/,
      );
    }
  });

  it('legacy hard-coded "PRD:" header is removed from ui / game-art decompose templates', () => {
    // The legacy ui/gameArt builders prefixed sources with the literal
    // string "PRD:" regardless of domain. The role-aware partial now
    // takes responsibility for the document label via {{documentName}}
    // (resolves to PRD / GDD), so the hard-coded inline header MUST be
    // gone from the templates.
    const offenders = BASE_PATHS.filter(rel => /^PRD:/m.test(read(rel)));
    expect(offenders).toEqual([]);
  });
});

// ──────────────────────────────────────────────────────────────────────
// Behavioural — buildDecomposeContext across 4 RAC modes
// ──────────────────────────────────────────────────────────────────────

const THRESHOLD = 200_000;

function pool(...artifacts: ResolvedArtifact[]): ArtifactPoolView {
  return new ArtifactPoolView(artifacts);
}

function ref(p: string, content = `[content of ${p}]`): ResolvedArtifact {
  return { path: p, role: 'ref', content };
}

function ctx(p: string, content = `[content of ${p}]`): ResolvedArtifact {
  return { path: p, role: 'context', content };
}

const SERVICE_STATE = { resolvedAction: { domain: 'service' as const } };
const GAME_STATE = { resolvedAction: { domain: 'game' as const } };

describe('buildDecomposeContext — RAC pipeline mode coverage', () => {
  it('explicit-ref-only: user picked PRD as the sole ref → role=ref sources, no context bucket', () => {
    // Mirrors detect/index.ts L113-148 (explicit branch).
    // metadata.refs=['plan/prd.md'] → loadResolvedArtifacts
    // marks the loaded file with role='ref'.
    const view = pool(ref('plan/prd.md', 'PRD content'));
    const c = buildDecomposeContext(view, SERVICE_STATE, {
      includePreviousDesign: true,
      toolModeThreshold: THRESHOLD,
    });
    expect(c.refs.sources?.body).toContain('PRD content');
    expect(c.context.sources).toBeUndefined();
    expect(c.refs.previousDesign).toBeUndefined();
    expect(c.context.previousDesign).toBeUndefined();
    expect(c.refs.other ?? []).toEqual([]);
    expect(c.context.other ?? []).toEqual([]);
    expect(c.documentName).toBe('PRD');
  });

  it('explicit-with-context-demote: PRD ref + previous design demoted to context', () => {
    // Mirrors a user explicitly placing a previous system design under
    // metadata.context — `loadResolvedArtifacts` emits role='context'
    // and the helper MUST surface it in the context bucket only.
    const view = pool(
      ref('plan/prd.md', 'PRD content'),
      ctx('architecture/system/be-system-main.md', 'previous BE design'),
    );
    const c = buildDecomposeContext(view, SERVICE_STATE, {
      includePreviousDesign: true,
      toolModeThreshold: THRESHOLD,
    });
    expect(c.refs.sources?.body).toContain('PRD content');
    expect(c.refs.previousDesign).toBeUndefined();
    expect(c.context.previousDesign).toBe('previous BE design');
    expect(c.context.sources).toBeUndefined();
  });

  it('infer-default: intent-matrix path-defaulted PRD as ref → identical output to explicit-ref-only', () => {
    // After `mergeWithMetadata` (rac.ts L595-613) the inferred
    // `plan/prd.md` ref carries through to RAC.refs and the
    // pool sees role='ref'. The decompose helper is mode-agnostic —
    // the partial output should be indistinguishable from the explicit
    // path because role provenance, not pipeline branch, is the SSOT.
    const view = pool(ref('plan/prd.md', 'PRD content'));
    const c = buildDecomposeContext(view, SERVICE_STATE, {
      includePreviousDesign: true,
      toolModeThreshold: THRESHOLD,
    });
    expect(c.refs.sources?.body).toContain('PRD content');
    expect(c.context.sources).toBeUndefined();
  });

  it('infer-additive: inferred PRD ref + metadata-additive system-design ref both surface as role=ref', () => {
    // Mirrors `dedup([...inferred.refs, ...metadata.refs])` —
    // intent-matrix default + user supplement BOTH end up as ref.
    // The previous-design system-design artifact is NOT in sources,
    // so it lands on `refs.previousDesign` (not `refs.sources`).
    const view = pool(
      ref('plan/prd.md', 'PRD content'),
      ref('architecture/system/be-system-main.md', 'BE design content'),
    );
    const c = buildDecomposeContext(view, SERVICE_STATE, {
      includePreviousDesign: true,
      toolModeThreshold: THRESHOLD,
    });
    expect(c.refs.sources?.body).toContain('PRD content');
    expect(c.refs.previousDesign).toBe('BE design content');
    expect(c.context.previousDesign).toBeUndefined();
  });
});

// ──────────────────────────────────────────────────────────────────────
// Domain awareness
// ──────────────────────────────────────────────────────────────────────

describe('buildDecomposeContext — domain-aware documentName', () => {
  it('service domain → documentName = "PRD"', () => {
    const c = buildDecomposeContext(pool(), SERVICE_STATE, {
      includePreviousDesign: false,
      toolModeThreshold: THRESHOLD,
    });
    expect(c.documentName).toBe('PRD');
  });

  it('game domain → documentName = "GDD" (replaces legacy "PRD:" hard-code)', () => {
    const c = buildDecomposeContext(pool(), GAME_STATE, {
      includePreviousDesign: false,
      toolModeThreshold: THRESHOLD,
    });
    expect(c.documentName).toBe('GDD');
  });

  it('undefined domain → defaults to service / "PRD" via getEffectiveDomain', () => {
    const c = buildDecomposeContext(pool(), {}, {
      includePreviousDesign: false,
      toolModeThreshold: THRESHOLD,
    });
    expect(c.documentName).toBe('PRD');
  });
});

// ──────────────────────────────────────────────────────────────────────
// Tool-mode threshold considers the FULL ref+context surface
// ──────────────────────────────────────────────────────────────────────

describe('buildDecomposeContext — tool-mode size accounting', () => {
  it('large explicit/additive ref outside sources/* still trips tool-mode', () => {
    // Regression guard: pre-(γ) implementation only measured
    // sources/* (`pool.sourcesSize()`), so a user adding a 250K
    // context artifact under architecture/... would silently keep
    // sources/* inline. The (γ) helper sums every ref+context
    // artifact's content length so the toolModeThreshold reflects
    // the actual prompt budget pressure.
    const big = ctx('architecture/system/be-system-main.md', 'X'.repeat(250_000));
    const small = ref('plan/prd.md', 'tiny');
    const c = buildDecomposeContext(pool(small, big), SERVICE_STATE, {
      includePreviousDesign: false,
      toolModeThreshold: 200_000,
    });
    expect(c.meta.sourcesMode).toBe('tool');
    // Sources inline body is short enough but the partial is told to
    // render the file index because the overall pool exceeds budget.
    expect(c.refs.sources?.mode).toBe('tool');
  });

  it('small pool stays inline', () => {
    const c = buildDecomposeContext(
      pool(ref('plan/prd.md', 'tiny')),
      SERVICE_STATE,
      { includePreviousDesign: false, toolModeThreshold: 200_000 },
    );
    expect(c.meta.sourcesMode).toBe('inline');
    expect(c.refs.sources?.mode).toBe('inline');
  });
});

// ──────────────────────────────────────────────────────────────────────
// Other-bucket surfacing for arbitrary explicit/additive paths
// ──────────────────────────────────────────────────────────────────────

describe('buildDecomposeContext — arbitrary explicit/additive paths', () => {
  it('explicit ref outside sources/* + outside system-design lands in refs.other', () => {
    // A user explicitly promoting a spec to ref (e.g. via
    // `actionMetadata.refs=['architecture/spec/spec-login.md']`)
    // MUST surface in the partial; the legacy implementation dropped
    // it because the inline string only concatenated sources/*.
    const view = pool(ref('architecture/spec/spec-login.md', 'login spec'));
    const c = buildDecomposeContext(view, SERVICE_STATE, {
      includePreviousDesign: false,
      toolModeThreshold: THRESHOLD,
    });
    expect(c.refs.other).toEqual([
      { path: 'architecture/spec/spec-login.md', content: 'login spec' },
    ]);
    expect(c.refs.sources).toBeUndefined();
  });

  it('context-only previous design lands in context.previousDesign, not refs', () => {
    const view = pool(ctx('architecture/system/be-system-main.md', 'prev'));
    const c = buildDecomposeContext(view, SERVICE_STATE, {
      includePreviousDesign: true,
      toolModeThreshold: THRESHOLD,
    });
    expect(c.context.previousDesign).toBe('prev');
    expect(c.refs.previousDesign).toBeUndefined();
  });
});

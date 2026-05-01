/**
 * Role-scoped ArtifactPoolView helpers — post-RAC template SSOT.
 *
 * Post-RAC templates (decompose / plan / execute for both code and
 * design jobs) gate sections on role+kind flags (e.g. `hasUiRef`,
 * `hasSystemDesignContext`) rather than role-agnostic `pool.hasUi()`.
 *
 * The critical invariant for explicit vs. infer equivalence: given the
 * same role-annotated artifact set, the role-scoped flags return the
 * same values regardless of whether the RAC was built from an explicit
 * user selection (refs[] / context[]) or inferred via loadResolvedArtifacts.
 */
import { describe, it, expect } from 'vitest';
import type { ResolvedArtifact } from '@ant/shared';
import { ArtifactPoolView } from '../../src/core/artifact/ArtifactPipeline';

const UI_TOKENS = 'visual/ui/ant/ui-tokens.json';
const UI_SPEC = 'visual/ui/ant/ui-spec.json';
const FE_SYSTEM = 'architecture/system/fe-system-main.md';
const BE_SYSTEM = 'architecture/system/be-system-main.md';
const SPEC_LOGIN = 'architecture/spec/spec-login.md';
const PRD = 'plan/prd.md';

describe('ArtifactPoolView — role-scoped presence checks', () => {
  it('hasUiRef is true only when a UI artifact has role=ref', () => {
    const pool: ResolvedArtifact[] = [
      { path: UI_TOKENS, content: '{}', role: 'context' },
    ];
    expect(new ArtifactPoolView(pool).hasUiRef()).toBe(false);
    expect(new ArtifactPoolView(pool).hasUiContext()).toBe(true);
    expect(new ArtifactPoolView(pool).hasUi()).toBe(true);

    const asRef: ResolvedArtifact[] = [
      { path: UI_TOKENS, content: '{}', role: 'ref' },
    ];
    expect(new ArtifactPoolView(asRef).hasUiRef()).toBe(true);
    expect(new ArtifactPoolView(asRef).hasUiContext()).toBe(false);
  });

  it('hasSystemDesignRef / hasSystemDesignContext discriminate by role', () => {
    const pool: ResolvedArtifact[] = [
      { path: FE_SYSTEM, content: '# FE', role: 'ref' },
      { path: BE_SYSTEM, content: '# BE', role: 'context' },
    ];
    const view = new ArtifactPoolView(pool);
    expect(view.hasSystemDesignRef()).toBe(true);
    expect(view.hasSystemDesignContext()).toBe(true);

    const contextOnly: ResolvedArtifact[] = [
      { path: FE_SYSTEM, content: '# FE', role: 'context' },
    ];
    expect(new ArtifactPoolView(contextOnly).hasSystemDesignRef()).toBe(false);
    expect(new ArtifactPoolView(contextOnly).hasSystemDesignContext()).toBe(true);
  });

  it('hasSpecRef only fires on role=ref spec artifacts', () => {
    const refSpec: ResolvedArtifact[] = [
      { path: SPEC_LOGIN, content: '# Login', role: 'ref' },
    ];
    const contextSpec: ResolvedArtifact[] = [
      { path: SPEC_LOGIN, content: '# Login', role: 'context' },
    ];
    expect(new ArtifactPoolView(refSpec).hasSpecRef()).toBe(true);
    expect(new ArtifactPoolView(contextSpec).hasSpecRef()).toBe(false);
    expect(new ArtifactPoolView(contextSpec).hasSpecContext()).toBe(true);
  });

  it('hasSourcesRef / hasSourcesContext discriminate by role', () => {
    const refPrd: ResolvedArtifact[] = [
      { path: PRD, content: '# PRD', role: 'ref' },
    ];
    const contextPrd: ResolvedArtifact[] = [
      { path: PRD, content: '# PRD', role: 'context' },
    ];
    expect(new ArtifactPoolView(refPrd).hasSourcesRef()).toBe(true);
    expect(new ArtifactPoolView(refPrd).hasSourcesContext()).toBe(false);
    expect(new ArtifactPoolView(contextPrd).hasSourcesRef()).toBe(false);
    expect(new ArtifactPoolView(contextPrd).hasSourcesContext()).toBe(true);
  });

  it('empty pool → every role-scoped helper returns false', () => {
    const view = new ArtifactPoolView([]);
    expect(view.hasUiRef()).toBe(false);
    expect(view.hasUiContext()).toBe(false);
    expect(view.hasSystemDesignRef()).toBe(false);
    expect(view.hasSystemDesignContext()).toBe(false);
    expect(view.hasSpecRef()).toBe(false);
    expect(view.hasSpecContext()).toBe(false);
    expect(view.hasSourcesRef()).toBe(false);
    expect(view.hasSourcesContext()).toBe(false);
  });

  it('role-scoped flags are insensitive to whether RAC came from explicit or infer', () => {
    // Same role-annotated artifact set; differs only in RAC source marker.
    // `loadResolvedArtifacts` maps rac.refs[] → role='ref' and
    // rac.context[] → role='context' regardless of source, so the pool
    // view must produce the same signals for explicit and infer paths.
    const explicitPool: ResolvedArtifact[] = [
      { path: FE_SYSTEM, content: '# FE', role: 'ref' },
      { path: UI_SPEC, content: '{}', role: 'context' },
    ];
    const inferPool: ResolvedArtifact[] = [
      { path: FE_SYSTEM, content: '# FE', role: 'ref' },
      { path: UI_SPEC, content: '{}', role: 'context' },
    ];

    const explicitView = new ArtifactPoolView(explicitPool);
    const inferView = new ArtifactPoolView(inferPool);

    const snapshot = (v: ArtifactPoolView) => ({
      hasSystemDesignRef: v.hasSystemDesignRef(),
      hasSystemDesignContext: v.hasSystemDesignContext(),
      hasUiRef: v.hasUiRef(),
      hasUiContext: v.hasUiContext(),
      hasSpecRef: v.hasSpecRef(),
      hasSourcesRef: v.hasSourcesRef(),
    });

    expect(snapshot(explicitView)).toEqual(snapshot(inferView));
    expect(snapshot(explicitView)).toEqual({
      hasSystemDesignRef: true,
      hasSystemDesignContext: false,
      hasUiRef: false,
      hasUiContext: true,
      hasSpecRef: false,
      hasSourcesRef: false,
    });
  });

  it('role-agnostic helpers still work for pre-RAC / internal consumers', () => {
    // `hasUi()` / `hasSystemDesign()` etc. remain internal helpers. They
    // MUST NOT reach post-RAC templates but pre-RAC consumers (e.g. the
    // decompose boundary heuristic) still rely on them.
    const pool: ResolvedArtifact[] = [
      { path: FE_SYSTEM, content: '# FE', role: 'context' },
      { path: UI_TOKENS, content: '{}', role: 'context' },
    ];
    const view = new ArtifactPoolView(pool);
    expect(view.hasSystemDesign()).toBe(true);
    expect(view.hasUi()).toBe(true);
    // Role-scoped siblings observe the SAME content but expose the
    // distinction that the docs are context, not ref:
    expect(view.hasSystemDesignRef()).toBe(false);
    expect(view.hasUiRef()).toBe(false);
    expect(view.hasSystemDesignContext()).toBe(true);
    expect(view.hasUiContext()).toBe(true);
  });
});

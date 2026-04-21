/**
 * Intent × role-flag matrix — post-RAC Gate / Contract / Background guard.
 *
 * The intent matrix (`@ant/shared/action-config-matrix.ts`) assigns
 * DIFFERENT roles to the same artifact kind across intents:
 *
 *   gen-code-sys   → UI=ref,  SYS=ref,  SPEC=--, SOURCES=context
 *   gen-code-spec  → UI=ctx,  SYS=ctx,  SPEC=ref, SOURCES=ctx
 *   rev-code       → UI=ctx,  SYS=ctx,  SPEC=ref (optional), SOURCES=--
 *   rev-ui         → UI=ref,  SYS=--,   SPEC=--, SOURCES=ctx
 *
 * Post-RAC templates must branch by what the block enforces (Gate /
 * Contract / Background — see `.cursorrules` "Post-RAC Template
 * Condition SSOT"), NOT by role. This test pins the Gate guarantee:
 * for every code intent that surfaces UI / system-design as ref OR
 * context, the corresponding `hasUi` / `hasSystemDesign` Gate flag
 * returns true. A regression that reintroduces `hasUiRef` as a Gate
 * (the `gen-code-spec` / `rev-code` regression) would trip this test.
 *
 * Mechanism: `resolveToRAC` alone does NOT populate slots (that's
 * detect/UI's job), and `loadResolvedArtifacts` requires a real FS.
 * We synthesize `ResolvedArtifact[]` directly from `getConfigSlots`
 * by projecting each SlotDef.path → a synthetic file + the role
 * implied by which array (refs / context) the slot came from. This
 * reproduces the only semantics `loadResolvedArtifacts` adds (role
 * assignment) without needing fixtures.
 */
import { describe, it, expect } from 'vitest';
import {
  getConfigSlots,
  type SlotDef,
  type ResolvedArtifact,
  type IntentId,
} from '@ant/shared';
import { ArtifactPoolView } from '../src/core/artifact/ArtifactPipeline';

function slotToArtifact(
  slot: SlotDef,
  role: 'ref' | 'context',
): ResolvedArtifact | null {
  // Codebase slots are not file-backed — they represent the project
  // code itself and never surface as ResolvedArtifact entries.
  if (slot.codebase) return null;
  // Empty-hint slots (e.g. `emptyRef()`, directive-only intents) have
  // no path and must be skipped.
  if (!slot.path) return null;
  const base = slot.path.endsWith('/') ? slot.path : `${slot.path}/`;
  return { path: `${base}dummy.md`, content: '# synthetic', role };
}

function buildSyntheticPool(intent: IntentId): ResolvedArtifact[] {
  const slots = getConfigSlots(intent);
  if (!slots) return [];
  const out: ResolvedArtifact[] = [];
  for (const s of slots.refs) {
    const a = slotToArtifact(s, 'ref');
    if (a) out.push(a);
  }
  for (const s of slots.context) {
    const a = slotToArtifact(s, 'context');
    if (a) out.push(a);
  }
  return out;
}

type FlagSnapshot = {
  hasUi: boolean;
  hasUiRef: boolean;
  hasUiContext: boolean;
  hasSystemDesign: boolean;
  hasSystemDesignRef: boolean;
  hasSystemDesignContext: boolean;
  hasSpec: boolean;
  hasSpecRef: boolean;
  hasSources: boolean;
  hasSourcesRef: boolean;
};

function snapshot(view: ArtifactPoolView): FlagSnapshot {
  return {
    hasUi: view.hasUi(),
    hasUiRef: view.hasUiRef(),
    hasUiContext: view.hasUiContext(),
    hasSystemDesign: view.hasSystemDesign(),
    hasSystemDesignRef: view.hasSystemDesignRef(),
    hasSystemDesignContext: view.hasSystemDesignContext(),
    hasSpec: view.hasSpec(),
    hasSpecRef: view.hasSpecRef(),
    hasSources: view.hasSources(),
    hasSourcesRef: view.hasSourcesRef(),
  };
}

describe('role-flag intent matrix — post-RAC Gate guarantees', () => {
  it('gen-code-sys: UI and system-design both surface as ref', () => {
    const view = new ArtifactPoolView(buildSyntheticPool('gen-code-sys'));
    expect(snapshot(view)).toMatchObject({
      hasUi: true,
      hasUiRef: true,
      hasUiContext: false,
      hasSystemDesign: true,
      hasSystemDesignRef: true,
      hasSystemDesignContext: false,
      hasSpec: false,
      hasSpecRef: false,
      hasSources: true,
      hasSourcesRef: false, // context only (inputs/sources as ctx)
    });
  });

  it('gen-code-spec: UI / system-design surface as CONTEXT — Gate still fires, Contract does not', () => {
    const view = new ArtifactPoolView(buildSyntheticPool('gen-code-spec'));
    const s = snapshot(view);
    // The regression-guarding invariant: even though UI is context,
    // `hasUi` (Gate) MUST be true so decompose's design-system ladder
    // and plan's TOKEN / ASSET inventories still fire.
    expect(s.hasUi).toBe(true);
    expect(s.hasUiRef).toBe(false);
    expect(s.hasUiContext).toBe(true);

    // Spec is the authoritative ref for gen-code-spec.
    expect(s.hasSpec).toBe(true);
    expect(s.hasSpecRef).toBe(true);

    // System-design is context — Contract flag OFF (plan's "API Contract
    // IMMUTABLE" must NOT fire from this slot alone; it re-fires later
    // via package-mapping in `deriveArtifactPolicy` which is out of
    // scope for this slot-level test).
    expect(s.hasSystemDesign).toBe(true);
    expect(s.hasSystemDesignRef).toBe(false);
    expect(s.hasSystemDesignContext).toBe(true);
  });

  it('rev-code: UI / system-design surface as CONTEXT (same Gate guarantee as gen-code-spec)', () => {
    const view = new ArtifactPoolView(buildSyntheticPool('rev-code'));
    const s = snapshot(view);
    expect(s.hasUi).toBe(true);
    expect(s.hasUiRef).toBe(false);
    expect(s.hasUiContext).toBe(true);

    expect(s.hasSystemDesign).toBe(true);
    expect(s.hasSystemDesignRef).toBe(false);
    expect(s.hasSystemDesignContext).toBe(true);

    // rev-code's first ref slot is the codebase itself (skipped by
    // buildSyntheticPool) and spec is an optional ref — it renders
    // when the user selects it. Without explicit selection we still
    // see `hasSpecRef=true` because our synthesizer maps every
    // refs[] slot to a ref-role artifact. This mirrors the behaviour
    // when the user DOES pick the optional spec.
    expect(s.hasSpecRef).toBe(true);
  });

  it('rev-ui: UI is ref (authoritative revise target)', () => {
    const view = new ArtifactPoolView(buildSyntheticPool('rev-ui'));
    const s = snapshot(view);
    expect(s.hasUi).toBe(true);
    expect(s.hasUiRef).toBe(true);
    expect(s.hasUiContext).toBe(false);
    expect(s.hasSystemDesign).toBe(false);
    expect(s.hasSources).toBe(true); // inputs/sources as context
    expect(s.hasSourcesRef).toBe(false);
  });

  it('regression guard — every UI-surfacing code intent activates the Gate', () => {
    // This is the headline invariant the 3-category taxonomy exists
    // to enforce. A change that re-introduces `hasUiRef` as a Gate
    // for any of these intents breaks this assertion.
    const intents: IntentId[] = ['gen-code-sys', 'gen-code-spec', 'rev-code', 'rev-ui'];
    for (const intent of intents) {
      const view = new ArtifactPoolView(buildSyntheticPool(intent));
      expect(view.hasUi(), `${intent}: Gate flag hasUi must be true`).toBe(true);
    }
  });

  it('explicit override path — user-promoted UI refs bypass the intent default', () => {
    // When the user explicitly selects UI as refs in a gen-code-spec
    // request (e.g. via the Action footer), `selectArtifactsWithPolicy`
    // re-stamps role='ref' on the selected artifacts. The Contract
    // flag then fires without any change to the intent matrix.
    const userPromoted: ResolvedArtifact[] = [
      { path: 'outputs/design/ui/ui-spec.json', content: '{}', role: 'ref' },
    ];
    const view = new ArtifactPoolView(userPromoted);
    expect(view.hasUi()).toBe(true);
    expect(view.hasUiRef()).toBe(true);
    expect(view.hasUiContext()).toBe(false);
  });

  it('empty pool — every flag is false (sanity)', () => {
    const view = new ArtifactPoolView([]);
    const s = snapshot(view);
    for (const [key, value] of Object.entries(s)) {
      expect(value, `${key} on empty pool must be false`).toBe(false);
    }
  });
});

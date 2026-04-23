/**
 * Visual Tier × UI doc gate — integration.
 *
 * When the user includes a UI design document (ant / figma / handoff) in
 * the post-RAC pool, the design document becomes the authoritative design
 * system and Visual Tier must be suppressed across every surface:
 *
 *   FE wizard tab visibility   ← `isVisualTierActive(..., hasUiDoc)`
 *   FE summary row visibility  ← `isVisualTierActive(..., hasUiDoc)`
 *   BE decompose template flag ← `isVisualTierActive(..., pool.hasUi())`
 *   BE prompt injection         ← same as decompose flag
 *
 * This regression links the two SSOT sources end-to-end:
 *   - FE: `pathsContainUiDoc(refs + context)` over user-selected RAC paths
 *   - BE: `ArtifactPoolView.hasUi()` over the post-RAC resolved pool
 *
 * Both feed the same `isVisualTierActive(basisSlot, techTier, hasUiDoc)`
 * predicate in `@ant/shared`. The test verifies that adding any one of
 * the three UiSource kinds into either source of truth closes the gate.
 */
import { describe, it, expect } from 'vitest';
import {
  isVisualTierActive,
  pathsContainUiDoc,
  type BasisSlotConfig,
  type TechTierConfig,
  type ResolvedArtifact,
} from '@ant/shared';
import { ArtifactPoolView } from '../../src/core/artifact/ArtifactPipeline';

const slot: BasisSlotConfig = { visualTier: true };
const fe: TechTierConfig = { stack: 'frontend' } as TechTierConfig;

const mk = (path: string, role: 'ref' | 'context' = 'ref'): ResolvedArtifact => ({
  path,
  role,
  content: '',
});

describe('Visual Tier × UI doc gate — FE surfaces', () => {
  it('gate is OPEN when no UI doc sits in user-selected RAC', () => {
    const refs = ['outputs/design/system/fe-system-app.md'];
    const ctx  = ['inputs/sources/prd.md'];
    expect(pathsContainUiDoc([...refs, ...ctx])).toBe(false);
    expect(isVisualTierActive(slot, fe, pathsContainUiDoc([...refs, ...ctx]))).toBe(true);
  });

  it.each([
    ['ant',     'outputs/design/ui/ant/ui-spec.json'],
    ['figma',   'outputs/design/ui/figma/figma.json'],
    ['handoff', 'outputs/design/ui/handoff/overview.html'],
  ])('gate CLOSES when a %s UI doc lives in refs', (_kind, path) => {
    const refs = [path];
    expect(pathsContainUiDoc(refs)).toBe(true);
    expect(isVisualTierActive(slot, fe, pathsContainUiDoc(refs))).toBe(false);
  });

  it('gate CLOSES when the UI doc is supplied via context (not refs)', () => {
    const ctx = ['outputs/design/ui/handoff/spec.md'];
    expect(pathsContainUiDoc(ctx)).toBe(true);
    expect(isVisualTierActive(slot, fe, pathsContainUiDoc(ctx))).toBe(false);
  });

  it('gate CLOSES even when refs+context mix non-UI paths alongside one UI doc', () => {
    const refs = ['outputs/design/system/fe-system-app.md'];
    const ctx  = ['inputs/sources/prd.md', 'outputs/design/ui/ant/ui-spec.json'];
    expect(pathsContainUiDoc([...refs, ...ctx])).toBe(true);
    expect(isVisualTierActive(slot, fe, pathsContainUiDoc([...refs, ...ctx]))).toBe(false);
  });
});

describe('Visual Tier × UI doc gate — BE ArtifactPoolView', () => {
  it('pool.hasUi() = false → gate OPEN', () => {
    const pool = new ArtifactPoolView([
      mk('outputs/design/system/fe-system-app.md'),
      mk('inputs/sources/prd.md', 'context'),
    ]);
    expect(pool.hasUi()).toBe(false);
    expect(isVisualTierActive(slot, fe, pool.hasUi())).toBe(true);
  });

  it.each([
    ['ant',     'outputs/design/ui/ant/ui-spec.json'],
    ['figma',   'outputs/design/ui/figma/figma.json'],
    ['handoff', 'outputs/design/ui/handoff/overview.html'],
  ])('pool.hasUi() = true via %s → gate CLOSED', (_kind, path) => {
    const pool = new ArtifactPoolView([mk(path)]);
    expect(pool.hasUi()).toBe(true);
    expect(isVisualTierActive(slot, fe, pool.hasUi())).toBe(false);
  });

  it('UI doc with role=context still closes the gate (role-agnostic)', () => {
    const pool = new ArtifactPoolView([
      mk('outputs/design/ui/ant/ui-spec.json', 'context'),
    ]);
    expect(pool.hasUi()).toBe(true);
    expect(isVisualTierActive(slot, fe, pool.hasUi())).toBe(false);
  });
});

describe('Visual Tier × UI doc gate — explicit-preset precedence', () => {
  // Even when the user has pre-seeded a visualTier preset, UI doc wins:
  // the gate predicate does not look at preset layer values — it only
  // decides whether the surface participates at all. BE decompose takes
  // the extra step of clearing `resolvedAction.basis.visualTier` so
  // downstream nodes don't observe a stale preset.
  it('hasUiDoc wins even when the slot is eligible and stack is frontend', () => {
    expect(isVisualTierActive(slot, fe, true)).toBe(false);
  });

  it('hasUiDoc wins for fullstack too', () => {
    const fs: TechTierConfig = { stack: 'fullstack' } as TechTierConfig;
    expect(isVisualTierActive(slot, fs, true)).toBe(false);
  });
});

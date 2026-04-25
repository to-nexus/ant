/**
 * Visual Tier × UI doc gate — integration.
 *
 * After Phase 1 D9 the gate funnels through `isTierActive('visualTier', ...)`.
 * Adding a UI design doc (ant / figma / handoff) into either source of truth
 * (FE selected RAC paths or BE ArtifactPoolView) closes the gate so the
 * downstream surfaces (FE wizard tab, FE summary row, BE decompose template
 * flag, BE prompt injection) skip visual tier emission.
 *
 * SSOT sources:
 *   - FE: `pathsContainUiDoc(refs + context)` over user-selected RAC paths
 *   - BE: `ArtifactPoolView.hasUi()` over the post-RAC resolved pool
 */
import { describe, it, expect } from 'vitest';
import {
  isTierActive,
  pathsContainUiDoc,
  type BasisSlotConfig,
  type TechTierConfig,
  type ResolvedArtifact,
} from '@ant/shared';
import { ArtifactPoolView } from '../../src/core/artifact/ArtifactPipeline';

const slot: BasisSlotConfig = { tiers: ['domain', 'visualTier'] };
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
    expect(isTierActive('visualTier', slot, 'service', { techTier: fe, hasUiDoc: pathsContainUiDoc([...refs, ...ctx]) })).toBe(true);
  });

  it.each([
    ['ant',     'outputs/design/ui/ant/ui-spec.json'],
    ['figma',   'outputs/design/ui/figma/figma.json'],
    ['handoff', 'outputs/design/ui/handoff/overview.html'],
  ])('gate CLOSES when a %s UI doc lives in refs', (_kind, path) => {
    const refs = [path];
    expect(pathsContainUiDoc(refs)).toBe(true);
    expect(isTierActive('visualTier', slot, 'service', { techTier: fe, hasUiDoc: pathsContainUiDoc(refs) })).toBe(false);
  });

  it('gate CLOSES when the UI doc is supplied via context (not refs)', () => {
    const ctx = ['outputs/design/ui/handoff/spec.md'];
    expect(pathsContainUiDoc(ctx)).toBe(true);
    expect(isTierActive('visualTier', slot, 'service', { techTier: fe, hasUiDoc: pathsContainUiDoc(ctx) })).toBe(false);
  });

  it('gate CLOSES even when refs+context mix non-UI paths alongside one UI doc', () => {
    const refs = ['outputs/design/system/fe-system-app.md'];
    const ctx  = ['inputs/sources/prd.md', 'outputs/design/ui/ant/ui-spec.json'];
    expect(pathsContainUiDoc([...refs, ...ctx])).toBe(true);
    expect(isTierActive('visualTier', slot, 'service', { techTier: fe, hasUiDoc: pathsContainUiDoc([...refs, ...ctx]) })).toBe(false);
  });
});

describe('Visual Tier × UI doc gate — BE ArtifactPoolView', () => {
  it('pool.hasUi() = false → gate OPEN', () => {
    const pool = new ArtifactPoolView([
      mk('outputs/design/system/fe-system-app.md'),
      mk('inputs/sources/prd.md', 'context'),
    ]);
    expect(pool.hasUi()).toBe(false);
    expect(isTierActive('visualTier', slot, 'service', { techTier: fe, hasUiDoc: pool.hasUi() })).toBe(true);
  });

  it.each([
    ['ant',     'outputs/design/ui/ant/ui-spec.json'],
    ['figma',   'outputs/design/ui/figma/figma.json'],
    ['handoff', 'outputs/design/ui/handoff/overview.html'],
  ])('pool.hasUi() = true via %s → gate CLOSED', (_kind, path) => {
    const pool = new ArtifactPoolView([mk(path)]);
    expect(pool.hasUi()).toBe(true);
    expect(isTierActive('visualTier', slot, 'service', { techTier: fe, hasUiDoc: pool.hasUi() })).toBe(false);
  });

  it('UI doc with role=context still closes the gate (role-agnostic)', () => {
    const pool = new ArtifactPoolView([
      mk('outputs/design/ui/ant/ui-spec.json', 'context'),
    ]);
    expect(pool.hasUi()).toBe(true);
    expect(isTierActive('visualTier', slot, 'service', { techTier: fe, hasUiDoc: pool.hasUi() })).toBe(false);
  });
});

describe('Visual Tier × UI doc gate — explicit-preset precedence', () => {
  it('hasUiDoc wins even when the slot is eligible and stack is frontend', () => {
    expect(isTierActive('visualTier', slot, 'service', { techTier: fe, hasUiDoc: true })).toBe(false);
  });

  it('hasUiDoc wins for fullstack too', () => {
    const fs: TechTierConfig = { stack: 'fullstack' } as TechTierConfig;
    expect(isTierActive('visualTier', slot, 'service', { techTier: fs, hasUiDoc: true })).toBe(false);
  });
});

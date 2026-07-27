/**
 * Handoff bundle-root normalization SSOT — `widenHandoffRefsToBundleDir`.
 *
 * tough-lacing-fable RCA: an explicit rev-game-art RAC carried a single
 * handoff FILE (`visual/game-art/handoff/project/design/README.md`) — the FE
 * `refsSingleSelect` collapse — so (1) the pool manifest held one stub,
 * (2) the decompose RAC read gate denied every other bundle path, and
 * (3) `validateHandoffReviseTargets` had a one-row `existing` set, while the
 * by-handoff revise prompt requires observing the whole bundle ("the disk
 * bundle is the layout authority"). The infer path already emits the bundle
 * DIR (`narrowSourceTreeParents` → `resolveUiSourceDir`); this SSOT converges
 * the explicit path onto that proven shape at the `resolveToRAC` funnel.
 *
 * Locks:
 *   - the helper widens any handoff-classified path (either surface) to its
 *     bundle root, deduped and idempotent, leaving other paths alone
 *   - `resolveToRAC` applies it to refs/context always, and to target in
 *     refactor mode only (generate producers keep verbatim output specs)
 *   - the widened RAC opens the whole bundle subtree at the RAC read gate
 */

import { describe, it, expect } from 'vitest';
import {
  widenHandoffRefsToBundleDir,
  resolveToRAC,
  ARTIFACT_PREFIX,
} from '@ant/shared';
import {
  computeRacScope,
  decideRacGate,
} from '../../src/agents/architect/graph/code/nodes/decompose/racGate';

const GAME_ART_ROOT = 'visual/game-art/handoff';
const UI_ROOT = 'visual/ui/handoff';

describe('widenHandoffRefsToBundleDir', () => {
  it('widens a single handoff file to its bundle root (both surfaces)', () => {
    expect(
      widenHandoffRefsToBundleDir(['visual/game-art/handoff/project/design/README.md']),
    ).toEqual([GAME_ART_ROOT]);
    expect(
      widenHandoffRefsToBundleDir(['visual/ui/handoff/site/index.html']),
    ).toEqual([UI_ROOT]);
  });

  it('dedupes N handoff files into one bundle-root entry', () => {
    expect(
      widenHandoffRefsToBundleDir([
        'visual/game-art/handoff/project/design/README.md',
        'visual/game-art/handoff/project/design/tokens/DesignTokens.dc.html',
        'visual/game-art/handoff/project/design/screens/GameScreen.dc.html',
      ]),
    ).toEqual([GAME_ART_ROOT]);
  });

  it('is idempotent on the bare root, with or without trailing slash', () => {
    expect(widenHandoffRefsToBundleDir([GAME_ART_ROOT])).toEqual([GAME_ART_ROOT]);
    expect(widenHandoffRefsToBundleDir([`${GAME_ART_ROOT}/`])).toEqual([GAME_ART_ROOT]);
    expect(widenHandoffRefsToBundleDir([UI_ROOT])).toEqual([UI_ROOT]);
  });

  it('passes non-handoff paths through unchanged, preserving order', () => {
    const input = [
      'plan/prd-main.md',
      'visual/game-art/handoff/project/design/README.md',
      'visual/ui/ant/ui-tokens.json',
    ];
    expect(widenHandoffRefsToBundleDir(input)).toEqual([
      'plan/prd-main.md',
      GAME_ART_ROOT,
      'visual/ui/ant/ui-tokens.json',
    ]);
  });

  it('returns undefined/empty input as-is', () => {
    expect(widenHandoffRefsToBundleDir(undefined)).toBeUndefined();
    expect(widenHandoffRefsToBundleDir([])).toEqual([]);
  });
});

describe('resolveToRAC — handoff bundle-root invariant', () => {
  it('explicit rev-game-art: file ref/target widen to the bundle dir (tough-lacing-fable shape)', () => {
    const file = 'visual/game-art/handoff/project/design/README.md';
    const rac = resolveToRAC(
      'rev-game-art',
      { refs: [file], target: [file], domain: 'game' },
      'explicit',
    );
    expect(rac.refs).toEqual([GAME_ART_ROOT]);
    expect(rac.target).toEqual([GAME_ART_ROOT]);
    expect(rac.hasExplicitFields).toBe(true);
    expect(rac.source).toBe('explicit');
  });

  it('rev-ui symmetry: ui handoff file widens the same way', () => {
    const file = 'visual/ui/handoff/site/index.html';
    const rac = resolveToRAC('rev-ui', { refs: [file], target: [file] }, 'explicit');
    expect(rac.refs).toEqual([UI_ROOT]);
    expect(rac.target).toEqual([UI_ROOT]);
  });

  it('generate producers keep their verbatim handoff output-spec target', () => {
    const outputs = [
      'visual/ui/handoff/DESIGN.md',
      'visual/ui/handoff/tokens/colors.css',
    ];
    const rac = resolveToRAC('gen-ui-desc', { target: outputs, context: ['plan/prd-main.md'] }, 'explicit');
    expect(rac.target).toEqual(outputs);
    expect(rac.context).toEqual(['plan/prd-main.md']);
  });

  it('infer path is unaffected (already bundle-dir shaped) — widen is a no-op', () => {
    const rac = resolveToRAC('rev-game-art', { refs: [GAME_ART_ROOT], target: [GAME_ART_ROOT] }, 'infer');
    expect(rac.refs).toEqual([GAME_ART_ROOT]);
    expect(rac.target).toEqual([GAME_ART_ROOT]);
  });
});

describe('widened RAC opens the bundle subtree at the read gate', () => {
  it('every read/list denied in tough-lacing-fable is allowed under the widened RAC', () => {
    const rac = resolveToRAC(
      'rev-game-art',
      { refs: ['visual/game-art/handoff/project/design/README.md'] },
      'explicit',
    );
    const scope = computeRacScope(rac as never);
    expect(scope).toBeDefined();

    const deniedInSession = [
      'visual/game-art/handoff/project/design/tokens',
      'visual/game-art/handoff/project/design/components',
      'visual/game-art/handoff/project/design/entities',
      'visual/game-art/handoff/project/design/screens',
      'visual/game-art/handoff/project/design/entities/UnitCatalog.dc.html',
      'visual/game-art/handoff/project/design/entities/Artifacts.dc.html',
      'visual/game-art/handoff/project/design/entities/ZoneGates.dc.html',
      'visual/game-art/handoff/project/design/components/HudKit.dc.html',
      'visual/game-art/handoff/project/design/tokens/DesignTokens.dc.html',
    ];
    for (const p of deniedInSession) {
      expect(decideRacGate(p, scope).allowed).toBe(true);
    }
  });

  it('non-RAC sibling artifacts stay denied', () => {
    const rac = resolveToRAC(
      'rev-game-art',
      { refs: ['visual/game-art/handoff/project/design/README.md'] },
      'explicit',
    );
    const scope = computeRacScope(rac as never);
    expect(decideRacGate('architecture/system/fe-system-main.md', scope).allowed).toBe(false);
    expect(decideRacGate('visual/game-art/ant/game-art-tokens.json', scope).allowed).toBe(false);
  });

  it('prefix constants stay aligned with the canonical roots', () => {
    expect(ARTIFACT_PREFIX.GAME_ART_HANDOFF).toBe(`${GAME_ART_ROOT}/`);
    expect(ARTIFACT_PREFIX.UI_HANDOFF).toBe(`${UI_ROOT}/`);
  });
});

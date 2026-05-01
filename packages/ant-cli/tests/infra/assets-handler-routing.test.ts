/**
 * Asset Handler Routing (Phase 2 — D22)
 *
 * Backstops `pickAssetsRoot` — the pure router behind both
 * `download_asset` and `list_assets`. The template at
 * `jobs/code/basis/gameArtTier/_preamble.md` and the design rules under
 * `jobs/design/basis/gameArtTier/_preamble.md` rely on the assertion that
 * a `game` workspace's tools never write into `assets/service/`
 * and vice versa; this suite makes that contract programmatic so a
 * refactor that re-introduces a hard-coded fallback trips a lint failure.
 *
 * Resolution order (most authoritative first):
 *   1. workspaceDomain — workspace-level 1st-class slot
 *   2. racDomain        — per-turn explicit/inferred override
 *   3. intentGroup === 'design-game-art' — implies game (matrix gate)
 *   4. default 'service'
 */

import { describe, it, expect } from 'vitest';
import { pickAssetsRoot } from '../../src/agents/architect/graph/design/nodes/tool/handlers/assets';

describe('Asset handler routing (D22) — pickAssetsRoot', () => {
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Workspace-level domain wins (the SSOT slot)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  it('routes to assets/service/ when workspace.domain === service', () => {
    expect(pickAssetsRoot({ workspaceDomain: 'service' }))
      .toBe('assets/service');
  });

  it('routes to assets/game/ when workspace.domain === game', () => {
    expect(pickAssetsRoot({ workspaceDomain: 'game' }))
      .toBe('assets/game');
  });

  it('workspaceDomain wins over racDomain (workspace SSOT precedence)', () => {
    expect(
      pickAssetsRoot({ workspaceDomain: 'game', racDomain: 'service' }),
    ).toBe('assets/game');
    expect(
      pickAssetsRoot({ workspaceDomain: 'service', racDomain: 'game' }),
    ).toBe('assets/service');
  });

  it('workspaceDomain wins over intentGroup === design-game-art', () => {
    expect(
      pickAssetsRoot({ workspaceDomain: 'service', intentGroup: 'design-game-art' }),
    ).toBe('assets/service');
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Fallback chain (no workspace domain)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  it('falls back to racDomain when workspaceDomain is absent', () => {
    expect(pickAssetsRoot({ racDomain: 'service' }))
      .toBe('assets/service');
    expect(pickAssetsRoot({ racDomain: 'game' }))
      .toBe('assets/game');
  });

  it('racDomain wins over intentGroup heuristic', () => {
    expect(
      pickAssetsRoot({ racDomain: 'service', intentGroup: 'design-game-art' }),
    ).toBe('assets/service');
  });

  it('falls back to game when intentGroup === design-game-art (matrix gate)', () => {
    expect(pickAssetsRoot({ intentGroup: 'design-game-art' }))
      .toBe('assets/game');
  });

  it('non-game-art intentGroups do NOT trigger the game heuristic', () => {
    expect(pickAssetsRoot({ intentGroup: 'design-ui' }))
      .toBe('assets/service');
    expect(pickAssetsRoot({ intentGroup: 'design-system' }))
      .toBe('assets/service');
  });

  it('all signals absent → default service', () => {
    expect(pickAssetsRoot({})).toBe('assets/service');
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Surface-isolation guarantees (D22 + I6 cross-check)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  it('a service workspace never resolves into the game pool, regardless of secondary signals', () => {
    const cases = [
      { workspaceDomain: 'service' as const, racDomain: 'game' as const },
      { workspaceDomain: 'service' as const, intentGroup: 'design-game-art' },
      { workspaceDomain: 'service' as const, racDomain: 'game' as const, intentGroup: 'design-game-art' },
    ];
    for (const c of cases) {
      const root = pickAssetsRoot(c);
      expect(root).toBe('assets/service');
      expect(root.startsWith('assets/game')).toBe(false);
    }
  });

  it('a game workspace never resolves into the service pool, regardless of secondary signals', () => {
    const cases = [
      { workspaceDomain: 'game' as const, racDomain: 'service' as const },
      { workspaceDomain: 'game' as const, intentGroup: 'design-ui' },
      { workspaceDomain: 'game' as const, racDomain: 'service' as const, intentGroup: 'design-ui' },
    ];
    for (const c of cases) {
      const root = pickAssetsRoot(c);
      expect(root).toBe('assets/game');
      expect(root.startsWith('assets/service')).toBe(false);
    }
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Return shape — relative path under assets/
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  it('always returns a relative path that starts with assets/ and ends without trailing slash', () => {
    for (const c of [
      { workspaceDomain: 'service' as const },
      { workspaceDomain: 'game' as const },
      { intentGroup: 'design-game-art' },
      {},
    ]) {
      const root = pickAssetsRoot(c);
      expect(root.startsWith('assets/')).toBe(true);
      expect(root.endsWith('/')).toBe(false);
    }
  });
});

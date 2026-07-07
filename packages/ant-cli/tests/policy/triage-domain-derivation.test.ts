/**
 * Game-Activation T1-a — `deriveTriageDomain` SSOT.
 *
 * Precedence: actionMetadata.domain → `design-game-art` intent group →
 * game-shaped workspaceState hint (`gdd.md` / `visual/game-art/`) →
 * default `'service'`.
 */

import { describe, it, expect } from 'vitest';
import { deriveTriageDomain } from '../../src/agents/common/graph/nodes/triage/derive.js';
import type { WorkspaceState } from '../../src/agents/common/graph/nodes/triage/types.js';
import type { ActionMetadata } from '@ant/shared';

const emptyWs: WorkspaceState = {
  hasPlan: false,
  hasMetaDirectives: false,
  hasMetaEvals: false,
  hasVisualUi: false,
  hasVisualGameArt: false,
  hasFigmaConfig: false,
  hasAssets: false,
  hasArchitectureSystem: false,
  hasArchitectureSpec: false,
  hasDesignDoc: false,
  hasCodebase: false,
};

describe('deriveTriageDomain (T1-a)', () => {
  it('1) actionMetadata.domain wins — explicit game', () => {
    expect(deriveTriageDomain('gen-spec', emptyWs, { domain: 'game' } as ActionMetadata)).toBe('game');
  });

  it('2) actionMetadata.domain=service beats a game-art intent group', () => {
    expect(
      deriveTriageDomain('gen-game-art-desc', emptyWs, { domain: 'service' } as ActionMetadata),
    ).toBe('service');
  });

  it('3) design-game-art intent group pins game on the infer path (no metadata)', () => {
    expect(deriveTriageDomain('gen-game-art-desc', emptyWs, undefined)).toBe('game');
    expect(deriveTriageDomain('rev-game-art', emptyWs, undefined)).toBe('game');
  });

  it('4) universal intent + gdd.md workspace hint → service (gdd.md is no longer a domain signal)', () => {
    const ws: WorkspaceState = { ...emptyWs, hasPlan: true, planFileNames: ['gdd.md'] };
    expect(deriveTriageDomain('gen-spec', ws, undefined)).toBe('service');
    expect(deriveTriageDomain('gen-sys-fe', ws, undefined)).toBe('service');
  });

  it('5) universal intent + game-art design docs present → game', () => {
    const ws: WorkspaceState = { ...emptyWs, hasVisualGameArt: true };
    expect(deriveTriageDomain('gen-code-sys', ws, undefined)).toBe('game');
  });

  it('6) universal intent + service workspace (prd.md) → service', () => {
    const ws: WorkspaceState = { ...emptyWs, hasPlan: true, planFileNames: ['prd.md'] };
    expect(deriveTriageDomain('gen-spec', ws, undefined)).toBe('service');
  });

  it('7) no metadata, no workspace hint, universal intent → service default', () => {
    expect(deriveTriageDomain('gen-spec', undefined, undefined)).toBe('service');
    expect(deriveTriageDomain('gen-ui-desc', emptyWs, undefined)).toBe('service');
  });
});

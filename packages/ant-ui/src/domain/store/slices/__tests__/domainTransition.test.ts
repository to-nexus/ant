/**
 * Phase 2 (D22 / D28) — domain transition contract for `updateActionMetadata`.
 *
 * The store centralizes three guarantees so every entry point
 * (DomainToggle / `@domain:` mention / future SSE broadcast) shares
 * the same behaviour:
 *
 *   (a) game → service drops `gameArtTier` / `gameContentTier` / `visualTier`
 *       (D28 — visualTier is service-only) and the `gameEngine` 5th slot
 *       from `basis.techTier`. service → game drops `visualTier` for the
 *       same reason.
 *   (b) If the currently-selected action card no longer passes the
 *       matrix gate (e.g. `design-game-art` on service or `design-ui` on
 *       game — D28), the wizard unwinds to `pick-action`. This is what
 *       kills the "intent screen blank" regression where ScrollableTabNav
 *       held a hidden tab id.
 *   (c) `actionMetadata.domain` itself is required (no `undefined`),
 *       seeded `'service'` at first paint and after `reset()`.
 */

import { describe, it, expect } from 'vitest';
import { create } from 'zustand';
import { createUISlice, type UISlice } from '../uiSlice';
import { createResetSlice, type ResetSlice } from '../resetSlice';

// Minimal store harness — only the slices we need for this contract.
type TestStore = UISlice & ResetSlice;

function makeStore() {
  return create<TestStore>()((...args) => ({
    ...createUISlice(...args),
    ...createResetSlice(...args),
  }));
}

describe('uiSlice — domain default seed (D22)', () => {
  it('initial actionMetadata.domain === "service"', () => {
    const store = makeStore();
    expect(store.getState().actionMetadata.domain).toBe('service');
  });

  it('reset() restores actionMetadata.domain === "service"', () => {
    const store = makeStore();
    store.getState().updateActionMetadata({ domain: 'game' });
    expect(store.getState().actionMetadata.domain).toBe('game');
    store.getState().reset();
    expect(store.getState().actionMetadata.domain).toBe('service');
  });
});

describe('uiSlice — domain transition cleanup (game → service)', () => {
  it('drops gameArtTier / gameContentTier on game → service', () => {
    const store = makeStore();
    store.getState().updateActionMetadata({ domain: 'game' });
    store.getState().updateActionMetadata({
      basis: {
        gameArtTier: { concept: 'sfFantasy', perspective: '2d' },
        gameContentTier: { genre: 'puzzle', coreLoop: 'solve' },
        visualTier: { visualLanguage: 'modernSaas' },
      },
    });
    store.getState().updateActionMetadata({ domain: 'service' });
    const basis = store.getState().actionMetadata.basis;
    expect(basis?.gameArtTier).toBeUndefined();
    expect(basis?.gameContentTier).toBeUndefined();
    expect(basis?.visualTier).toEqual({ visualLanguage: 'modernSaas' });
  });

  it('drops techTier.{frontend,backend}.gameEngine on game → service', () => {
    const store = makeStore();
    store.getState().updateActionMetadata({
      domain: 'game',
      basis: {
        techTier: {
          stack: 'frontend',
          frontend: { language: 'typescript', framework: 'react', gameEngine: 'phaser' } as any,
        },
      },
    });
    store.getState().updateActionMetadata({ domain: 'service' });
    const basis = store.getState().actionMetadata.basis;
    expect((basis?.techTier?.frontend as any)?.gameEngine).toBeUndefined();
    expect((basis?.techTier?.frontend as any)?.framework).toBe('react');
  });

  it('service → game preserves visualTier (no cleanup needed)', () => {
    const store = makeStore();
    store.getState().updateActionMetadata({
      basis: { visualTier: { visualLanguage: 'modernSaas' } },
    });
    store.getState().updateActionMetadata({ domain: 'game' });
    expect(store.getState().actionMetadata.basis?.visualTier).toEqual({
      visualLanguage: 'modernSaas',
    });
  });
});

describe('uiSlice — domain gate unwind (D22)', () => {
  it('game → service unwinds selectedActionId === "design-game-art" (intent-screen-blank fix)', () => {
    const store = makeStore();
    store.getState().updateActionMetadata({ domain: 'game' });
    store.getState().selectAction('design-game-art');
    store.getState().selectIntent('gen-game-art-figma');
    // ActionsPanel's intent-pick handler sets the step explicitly. Mirror
    // that here so the unwind test starts from a real-user-equivalent
    // state (`config` step holding `selectedActionId='design-game-art'`).
    store.getState().setActionsStep('config');
    expect(store.getState().selectedActionId).toBe('design-game-art');
    expect(store.getState().actionsStep).toBe('config');

    store.getState().updateActionMetadata({ domain: 'service' });

    expect(store.getState().selectedActionId).toBeNull();
    expect(store.getState().selectedIntentId).toBeNull();
    expect(store.getState().actionsStep).toBe('pick-action');
    expect(store.getState().actionMetadata.intent).toBeUndefined();
  });

  it('domain-agnostic cards survive the transition (e.g. plan)', () => {
    const store = makeStore();
    store.getState().updateActionMetadata({ domain: 'game' });
    store.getState().selectAction('plan');
    store.getState().updateActionMetadata({ domain: 'service' });
    expect(store.getState().selectedActionId).toBe('plan');
  });
});

describe('uiSlice — domain stickiness across navigation', () => {
  it('selectAction preserves the workspace-level domain', () => {
    const store = makeStore();
    store.getState().updateActionMetadata({ domain: 'game' });
    store.getState().selectAction('design-ui');
    expect(store.getState().actionMetadata.domain).toBe('game');
  });

  it('selectIntent preserves the workspace-level domain', () => {
    const store = makeStore();
    store.getState().updateActionMetadata({ domain: 'game' });
    store.getState().selectAction('design-ui');
    store.getState().selectIntent('gen-ui-figma');
    expect(store.getState().actionMetadata.domain).toBe('game');
  });

  it('resetActionMetadata preserves the workspace-level domain', () => {
    const store = makeStore();
    store.getState().updateActionMetadata({ domain: 'game' });
    store.getState().resetActionMetadata();
    expect(store.getState().actionMetadata.domain).toBe('game');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// techTier IntentGroup scoping — code-job tech choices must NOT leak into
// design-job intents and vice versa. Other tiers stay sticky on `basis`.
// ─────────────────────────────────────────────────────────────────────────

describe('uiSlice — techTier IntentGroup scoping', () => {
  it('group switch caches outgoing techTier and clears the live mirror', () => {
    const store = makeStore();
    store.getState().selectAction('code');
    store.getState().updateActionMetadata({
      basis: { techTier: { stack: 'fullstack', frontend: { language: 'typescript', stack: 'frontend' } } },
    });
    expect(store.getState().actionMetadata.basis?.techTier?.stack).toBe('fullstack');

    store.getState().selectAction('design-system');
    // techTier mirrored to cache for code; design-system has nothing yet.
    expect(store.getState().actionMetadata.techTierByGroup?.code?.stack).toBe('fullstack');
    expect(store.getState().actionMetadata.basis?.techTier).toBeUndefined();
  });

  it('round-trip restores per-group techTier on revisit', () => {
    const store = makeStore();
    store.getState().selectAction('code');
    store.getState().updateActionMetadata({
      basis: { techTier: { stack: 'fullstack' } },
    });
    store.getState().selectAction('design-system');
    store.getState().updateActionMetadata({
      basis: { techTier: { stack: 'backend' } },
    });

    store.getState().selectAction('code');
    expect(store.getState().actionMetadata.basis?.techTier?.stack).toBe('fullstack');

    store.getState().selectAction('design-system');
    expect(store.getState().actionMetadata.basis?.techTier?.stack).toBe('backend');
  });

  it('other tiers (visualTier / gameContentTier) stay sticky across group changes', () => {
    const store = makeStore();
    store.getState().selectAction('code');
    store.getState().updateActionMetadata({
      basis: {
        techTier: { stack: 'fullstack' },
        visualTier: { visualLanguage: 'modernSaas' },
      },
    });

    store.getState().selectAction('design-ui');
    // techTier rotated out, visualTier survives untouched.
    expect(store.getState().actionMetadata.basis?.techTier).toBeUndefined();
    expect(store.getState().actionMetadata.basis?.visualTier).toEqual({ visualLanguage: 'modernSaas' });
  });

  it('selectIntent applies the new intent\'s lockedStack to basis.techTier', () => {
    const store = makeStore();
    store.getState().selectAction('design-system');
    store.getState().updateActionMetadata({
      basis: { techTier: { stack: 'fullstack' } },
    });

    store.getState().selectIntent('gen-sys-fe');
    expect(store.getState().actionMetadata.basis?.techTier?.stack).toBe('frontend');

    store.getState().selectIntent('gen-sys-be');
    expect(store.getState().actionMetadata.basis?.techTier?.stack).toBe('backend');

    store.getState().selectIntent('gen-sys-full');
    expect(store.getState().actionMetadata.basis?.techTier?.stack).toBe('fullstack');
  });

  it('selectIntent on an unlocked intent leaves techTier untouched', () => {
    const store = makeStore();
    store.getState().selectAction('code');
    store.getState().updateActionMetadata({
      basis: { techTier: { stack: 'fullstack' } },
    });
    store.getState().selectIntent('gen-code-sys');
    expect(store.getState().actionMetadata.basis?.techTier?.stack).toBe('fullstack');
    store.getState().selectIntent('rev-code');
    expect(store.getState().actionMetadata.basis?.techTier?.stack).toBe('fullstack');
  });

  it('resetActionMetadata caches current techTier for later restore', () => {
    const store = makeStore();
    store.getState().selectAction('code');
    store.getState().updateActionMetadata({
      basis: { techTier: { stack: 'frontend', frontend: { language: 'typescript', stack: 'frontend' } } },
    });
    store.getState().resetActionMetadata();
    expect(store.getState().selectedActionId).toBeNull();
    expect(store.getState().actionMetadata.basis?.techTier).toBeUndefined();
    expect(store.getState().actionMetadata.techTierByGroup?.code?.stack).toBe('frontend');

    store.getState().openActionsPanel('code');
    expect(store.getState().actionMetadata.basis?.techTier?.stack).toBe('frontend');
  });

  it('domain unwind to pick-action retires the live techTier into the cache', () => {
    const store = makeStore();
    store.getState().updateActionMetadata({ domain: 'game' });
    store.getState().selectAction('design-game-art');
    store.getState().updateActionMetadata({
      basis: {
        techTier: { stack: 'frontend', frontend: { language: 'typescript', stack: 'frontend', gameEngine: 'phaser' } },
      },
    });

    store.getState().updateActionMetadata({ domain: 'service' });
    expect(store.getState().selectedActionId).toBeNull();
    // Cache survives so the user's prior choice is restored if they revisit.
    // gameEngine is scrubbed by the domain transition itself.
    const cached = store.getState().actionMetadata.techTierByGroup?.['design-game-art'];
    expect(cached?.stack).toBe('frontend');
    expect(cached?.frontend?.gameEngine).toBeUndefined();
  });
});

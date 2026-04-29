/**
 * uiSlice — hard-exclusive UiSource invariant on `updateActionMetadata`.
 *
 * The store SHOULD be impossible to drive into a state where
 * `actionMetadata.refs` or `actionMetadata.context` carries paths from more
 * than one UiSource. This is enforced by routing every patch through
 * `normalizeUiSourceRefs` (canonical.ts SSOT) inside `updateActionMetadata`.
 *
 * If this contract regresses, BE detect's `validateUiSourceExclusivity`
 * starts throwing on otherwise-valid user flows (the `gen-code-sys`
 * `autumn-living-penny` job-runner crash). Tests live next to the slice
 * so a future refactor breaks here before it breaks in production.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { create } from 'zustand';
import { createUISlice, type UISlice } from '../uiSlice';
import { createResetSlice, type ResetSlice } from '../resetSlice';

// `persistWorkspaceDomain` writes back to disk via api; mock so domain
// patches in this test don't try to make network calls.
const { updateProjectConfigMock } = vi.hoisted(() => ({
  updateProjectConfigMock: vi.fn(),
}));
vi.mock('@/infrastructure/http/api', () => ({
  updateProjectConfig: updateProjectConfigMock,
}));

beforeEach(() => {
  updateProjectConfigMock.mockReset();
  updateProjectConfigMock.mockResolvedValue(undefined);
});

type TestStore = UISlice & ResetSlice;

function makeStore() {
  return create<TestStore>()((...args) => ({
    ...createUISlice(...args),
    ...createResetSlice(...args),
  }));
}

describe('uiSlice.updateActionMetadata — UiSource hard-exclusive invariant', () => {
  it('drops figma when ant + figma are patched into refs (ant wins)', () => {
    const store = makeStore();
    store.getState().updateActionMetadata({
      intent: 'gen-code-sys',
    });
    store.getState().updateActionMetadata({
      refs: ['visual/ui/ant/ui-tokens.json', 'visual/ui/figma/figma.json'],
    });
    expect(store.getState().actionMetadata.refs).toEqual([
      'visual/ui/ant/ui-tokens.json',
    ]);
  });

  it('preserves single-source refs unchanged', () => {
    const store = makeStore();
    store.getState().updateActionMetadata({ intent: 'gen-code-sys' });
    store.getState().updateActionMetadata({
      refs: ['visual/ui/ant/ui-tokens.json', 'visual/ui/ant/ui-spec.json'],
    });
    expect(store.getState().actionMetadata.refs).toEqual([
      'visual/ui/ant/ui-tokens.json',
      'visual/ui/ant/ui-spec.json',
    ]);
  });

  it('keeps non-UI paths alongside the chosen UI source', () => {
    const store = makeStore();
    store.getState().updateActionMetadata({ intent: 'gen-code-sys' });
    store.getState().updateActionMetadata({
      refs: [
        'architecture/system/fe-system-main.md',
        'visual/ui/ant/ui-tokens.json',
        'visual/ui/figma/figma.json',
      ],
    });
    expect(store.getState().actionMetadata.refs).toEqual([
      'architecture/system/fe-system-main.md',
      'visual/ui/ant/ui-tokens.json',
    ]);
  });

  it('normalizes context as well as refs', () => {
    const store = makeStore();
    store.getState().updateActionMetadata({ intent: 'gen-code-spec' });
    store.getState().updateActionMetadata({
      context: ['visual/ui/figma/figma.json', 'visual/ui/handoff/page.html'],
    });
    expect(store.getState().actionMetadata.context).toEqual([
      'visual/ui/figma/figma.json',
    ]);
  });

  it('handles a toggle that adds a competing source — invariant restored on next patch', () => {
    // First patch: ant selected.
    const store = makeStore();
    store.getState().updateActionMetadata({ intent: 'gen-code-sys' });
    store.getState().updateActionMetadata({
      refs: ['visual/ui/ant/ui-tokens.json'],
    });
    expect(store.getState().actionMetadata.refs).toEqual([
      'visual/ui/ant/ui-tokens.json',
    ]);

    // Second patch: caller appends a figma path (e.g. mention-driven set).
    // The setter should drop figma since ant remains in the merged set.
    store.getState().updateActionMetadata({
      refs: ['visual/ui/ant/ui-tokens.json', 'visual/ui/figma/figma.json'],
    });
    expect(store.getState().actionMetadata.refs).toEqual([
      'visual/ui/ant/ui-tokens.json',
    ]);
  });

  it('intent change still wipes refs / context (priority over normalization)', () => {
    const store = makeStore();
    store.getState().updateActionMetadata({ intent: 'gen-code-sys' });
    store.getState().updateActionMetadata({
      refs: ['visual/ui/ant/ui-tokens.json'],
    });
    store.getState().updateActionMetadata({ intent: 'gen-spec' });
    expect(store.getState().actionMetadata.refs).toBeUndefined();
    expect(store.getState().actionMetadata.context).toBeUndefined();
  });
});

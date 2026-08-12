/**
 * uiSlice — the revise-target derivation has exactly ONE owner.
 *
 * A `revise` intent's target is not "whatever the refs are": a figma ref
 * regenerates the surface's ant JSON trio (ref ≠ target by design) and a
 * handoff ref revises the bundle in place, so the target is the bundle
 * DIRECTORY. `getDefaultTargetPaths` (action-config-matrix.ts) owns those rules.
 *
 * The panel used to call that SSOT at its own three call sites while BOTH
 * `FileTreePicker` entry points (the action tab's free-add and the chat
 * composer's `@ref:` Browse row) bypassed it and fell through to a verbatim
 * `next.target = next.refs` mirror in the store — so picking the same handoff
 * ref by toggle vs by picker produced two different targets. Deriving it inside
 * `updateActionMetadata` is what makes every entry point agree, because every
 * entry point already funnels through this one writer.
 *
 * Runner: vitest.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { create } from 'zustand';
import { createUISlice, type UISlice } from '../uiSlice';
import { createResetSlice, type ResetSlice } from '../resetSlice';

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

type TestStore = UISlice & ResetSlice & { applyJobIdentity: (args: unknown) => void };

function makeStore() {
  return create<TestStore>()((...args) => ({
    ...createUISlice(...args),
    ...createResetSlice(...args),
    applyJobIdentity: () => {},
  }));
}

/** Patch intent then refs — the shape every picker / toggle produces. */
function selectRefs(intent: string, refs: string[]) {
  const store = makeStore();
  store.getState().updateActionMetadata({ intent: intent as never });
  store.getState().updateActionMetadata({ refs });
  return store.getState().actionMetadata;
}

describe('uiSlice.updateActionMetadata — revise-target derivation', () => {
  it('rev-ui + figma ref → the ant JSON trio, NOT the figma ref', () => {
    const meta = selectRefs('rev-ui', ['visual/ui/figma/figma.json']);
    expect(meta.target).toEqual([
      'visual/ui/ant/ui-tokens.json',
      'visual/ui/ant/ui-assets.json',
      'visual/ui/ant/ui-spec.json',
    ]);
    expect(meta.target).not.toContain('visual/ui/figma/figma.json');
  });

  it('rev-ui + handoff refs → the bundle DIRECTORY, not the individual files', () => {
    const meta = selectRefs('rev-ui', [
      'visual/ui/handoff/DESIGN.md',
      'visual/ui/handoff/screens/login.md',
    ]);
    expect(meta.target).toEqual(['visual/ui/handoff']);
  });

  it('rev-ui + ant refs → the refs themselves (revised in place)', () => {
    const refs = ['visual/ui/ant/ui-spec.json'];
    expect(selectRefs('rev-ui', refs).target).toEqual(refs);
  });

  it('rev-spec (refsSingleSelect) + one ref → that ref', () => {
    expect(selectRefs('rev-spec', ['spec/feature.md']).target).toEqual(['spec/feature.md']);
  });

  it('rev-spec + two refs → undefined (a multi-selection stays invalid)', () => {
    expect(selectRefs('rev-spec', ['spec/a.md', 'spec/b.md']).target).toBeUndefined();
  });

  it('rev-plan with no refs → the canonical plan document', () => {
    const store = makeStore();
    store.getState().updateActionMetadata({ intent: 'rev-plan' });
    store.getState().updateActionMetadata({ refs: undefined });
    expect(store.getState().actionMetadata.target).toEqual(['plan/prd.md']);
  });

  /**
   * Domain-driven cleanup belongs to this branch, not to a view's mount effect.
   * It used to happen incidentally because `ActionConfigView`'s seeding effect
   * listed `domain` as a dep — which left the chat-composer path (no such
   * effect) holding stale wrong-domain selections.
   */
  it('a domain change drops artifact selections (the catalog itself switches domain)', () => {
    const store = makeStore();
    store.getState().updateActionMetadata({ intent: 'gen-plan' });
    store.getState().updateActionMetadata({ refs: ['plan/prd.md'], context: ['docs/a.md'] });
    store.getState().updateActionMetadata({ domain: 'game' });

    const meta = store.getState().actionMetadata;
    expect(meta.domain).toBe('game');
    expect(meta.refs).toBeUndefined();
    expect(meta.context).toBeUndefined();
    expect(meta.target).toBeUndefined();
  });

  it('a same-domain patch leaves selections alone', () => {
    const store = makeStore();
    store.getState().updateActionMetadata({ intent: 'gen-plan' });
    store.getState().updateActionMetadata({ refs: ['plan/prd.md'] });
    store.getState().updateActionMetadata({ domain: 'service' });
    expect(store.getState().actionMetadata.refs).toEqual(['plan/prd.md']);
  });

  it('a generate intent keeps a user-chosen target when refs change', () => {
    const store = makeStore();
    store.getState().updateActionMetadata({ intent: 'gen-code-sys' });
    store.getState().updateActionMetadata({ target: ['codebase/src/custom.ts'] });
    store.getState().updateActionMetadata({ refs: ['architecture/fe-system-a.md'] });
    // Only `revise` intents derive their target from refs — clobbering a
    // generate target on every refs patch would fight the `@target:` picker.
    expect(store.getState().actionMetadata.target).toEqual(['codebase/src/custom.ts']);
  });
});

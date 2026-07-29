import { describe, it, expect } from 'vitest';
import { getEditorTabActionPolicy } from '../../src/presentation/components/MainPanelTabsBar/components/editorTabUiPolicy';

describe('editorTabUiPolicy', () => {
  it('hides close for pinned tabs', () => {
    const policy = getEditorTabActionPolicy({ kind: 'real', pinned: true, status: 'ready' });
    expect(policy.showCloseButton).toBe(false);
    expect(policy.showPinToggle).toBe(true);
  });

  it('locks pin toggle and shows streaming state while streaming', () => {
    const policy = getEditorTabActionPolicy({ kind: 'real', pinned: true, status: 'streaming' });
    expect(policy.isStreaming).toBe(true);
    expect(policy.showPinToggle).toBe(false);
    expect(policy.showCloseButton).toBe(false);
  });

  it('keeps close button for unpinned tabs', () => {
    const policy = getEditorTabActionPolicy({ kind: 'real', pinned: false, status: 'ready' });
    expect(policy.showCloseButton).toBe(true);
    expect(policy.showPinToggle).toBe(true);
  });

  // Regression — a subagent report tab is minted `virtual` + `pinned: true`
  // (`pinned` there only means "not the shared preview slot"). Deriving the
  // policy from `pinned` alone advertised a pin toggle that `unpinEditorTab`
  // rejects on `kind !== 'real'` (a dead button) AND suppressed the close
  // button, leaving the tab permanently unclosable.
  it('hides pin toggle and keeps close for a settled virtual tab', () => {
    const policy = getEditorTabActionPolicy({ kind: 'virtual', pinned: true, status: 'ready' });
    expect(policy.isStreaming).toBe(false);
    expect(policy.showPinToggle).toBe(false);
    expect(policy.showCloseButton).toBe(true);
  });

  // A streaming virtual tab stays non-closable: `syncVirtualEditorTabsFromBuffers`
  // recreates and re-focuses it on the next buffer snapshot.
  it('offers neither action for a streaming virtual tab', () => {
    const policy = getEditorTabActionPolicy({ kind: 'virtual', pinned: true, status: 'streaming' });
    expect(policy.isStreaming).toBe(true);
    expect(policy.showPinToggle).toBe(false);
    expect(policy.showCloseButton).toBe(false);
  });
});

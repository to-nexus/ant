import { describe, it, expect } from 'vitest';
import { getEditorTabActionPolicy } from '../../src/presentation/components/MainPanelTabsBar/components/editorTabUiPolicy';

describe('editorTabUiPolicy', () => {
  it('hides close for pinned tabs', () => {
    const policy = getEditorTabActionPolicy({ pinned: true, status: 'ready' });
    expect(policy.showCloseButton).toBe(false);
    expect(policy.showPinToggle).toBe(true);
  });

  it('locks pin toggle and shows streaming state while streaming', () => {
    const policy = getEditorTabActionPolicy({ pinned: true, status: 'streaming' });
    expect(policy.isStreaming).toBe(true);
    expect(policy.showPinToggle).toBe(false);
    expect(policy.showCloseButton).toBe(false);
  });

  it('keeps close button for unpinned tabs', () => {
    const policy = getEditorTabActionPolicy({ pinned: false, status: 'ready' });
    expect(policy.showCloseButton).toBe(true);
    expect(policy.showPinToggle).toBe(true);
  });
});

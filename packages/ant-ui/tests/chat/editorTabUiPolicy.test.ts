import { describe, it, expect } from 'vitest';
import type { ChatStatusLine, ChatStatusType } from '@ant/shared';
import { getEditorTabActionPolicy } from '../../src/presentation/components/MainPanelTabsBar/components/editorTabUiPolicy';
import { shouldSuppressPreviewOnlyStatusCard } from '../../src/presentation/components/chat/statusCardVisibility';

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

/**
 * Which surface renders a file status.
 *
 * `plan` / `design` artifact writes render in the main-panel editor tab, so
 * their success/progress cards are suppressed in chat as duplicates. Failures
 * are NOT: the preview surface has no failure renderer (promotion fires on
 * `file_create` / `file_edit` only), so suppressing them left a failed
 * artifact write invisible everywhere — the tab just disappeared.
 *
 * Boundary: preview owns the success path, chat owns the failure path.
 */
describe('shouldSuppressPreviewOnlyStatusCard — surface boundary', () => {
  const line = (jobType: string, statusType: ChatStatusType): ChatStatusLine =>
    ({ jobType, statusType } as ChatStatusLine);

  const PREVIEW_OWNED: ChatStatusType[] = [
    'file_creating', 'file_writing', 'file_create',
    'file_editing', 'file_updating', 'file_edit',
    'file_deleting', 'file_delete',
    'plan_generating', 'plan',
    'task_response_streaming', 'task_response',
  ];
  const FAILURES: ChatStatusType[] = ['file_create_failed', 'file_edit_failed', 'file_delete_failed'];

  for (const jobType of ['plan', 'design']) {
    it.each(PREVIEW_OWNED)(`${jobType}: suppresses %s (preview renders it)`, (statusType) => {
      expect(shouldSuppressPreviewOnlyStatusCard(line(jobType, statusType))).toBe(true);
    });

    it.each(FAILURES)(`${jobType}: keeps %s in chat (preview cannot render it)`, (statusType) => {
      expect(shouldSuppressPreviewOnlyStatusCard(line(jobType, statusType))).toBe(false);
    });
  }

  it.each([...PREVIEW_OWNED, ...FAILURES])('code: keeps %s in chat (no editor tab)', (statusType) => {
    expect(shouldSuppressPreviewOnlyStatusCard(line('code', statusType))).toBe(false);
  });
});

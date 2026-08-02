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
 * `plan` / `design` writes of a DOCUMENT (`.md` / `.html`) render in the
 * main-panel editor tab, so their success/progress cards are suppressed in
 * chat as duplicates. Three classes are NOT suppressed, all for the same
 * reason — the preview surface cannot render them, so chat is the only
 * surface left:
 *   - failures (promotion fires on `file_create` / `file_edit` only),
 *   - deletions (no preview renderer at all),
 *   - non-document artifacts (`.json` / `.css` / …), which fall back to the
 *     code-job file card.
 *
 * Boundary: preview owns the document create/edit success path, chat owns
 * everything else.
 */
describe('shouldSuppressPreviewOnlyStatusCard — surface boundary', () => {
  const DOC = 'architecture/spec/spec-main.md';
  const ASSET = 'visual/ui/ant/ui-tokens.json';
  const line = (jobType: string, statusType: ChatStatusType, filePath?: string): ChatStatusLine =>
    ({ jobType, statusType, metadata: filePath ? { filePath } : {} } as ChatStatusLine);

  const PREVIEW_OWNED_FILE: ChatStatusType[] = [
    'file_creating', 'file_writing', 'file_create',
    'file_editing', 'file_updating', 'file_edit',
  ];
  const PREVIEW_OWNED_PATHLESS: ChatStatusType[] = [
    'plan_generating', 'plan',
    'task_response_streaming', 'task_response',
  ];
  const DELETES: ChatStatusType[] = ['file_deleting', 'file_delete'];
  const FAILURES: ChatStatusType[] = ['file_create_failed', 'file_edit_failed', 'file_delete_failed'];

  for (const jobType of ['plan', 'design']) {
    it.each(PREVIEW_OWNED_FILE)(`${jobType}: suppresses %s for a document (preview renders it)`, (statusType) => {
      expect(shouldSuppressPreviewOnlyStatusCard(line(jobType, statusType, DOC))).toBe(true);
    });

    it.each(PREVIEW_OWNED_FILE)(`${jobType}: keeps %s in chat for a non-document artifact`, (statusType) => {
      expect(shouldSuppressPreviewOnlyStatusCard(line(jobType, statusType, ASSET))).toBe(false);
    });

    it.each(PREVIEW_OWNED_PATHLESS)(`${jobType}: suppresses %s (preview renders it)`, (statusType) => {
      expect(shouldSuppressPreviewOnlyStatusCard(line(jobType, statusType))).toBe(true);
    });

    it.each(DELETES)(`${jobType}: keeps %s in chat (preview cannot render it)`, (statusType) => {
      expect(shouldSuppressPreviewOnlyStatusCard(line(jobType, statusType, DOC))).toBe(false);
    });

    it.each(FAILURES)(`${jobType}: keeps %s in chat (preview cannot render it)`, (statusType) => {
      expect(shouldSuppressPreviewOnlyStatusCard(line(jobType, statusType, DOC))).toBe(false);
    });
  }

  it.each([...PREVIEW_OWNED_FILE, ...PREVIEW_OWNED_PATHLESS, ...DELETES, ...FAILURES])(
    'code: keeps %s in chat (no editor tab)',
    (statusType) => {
      expect(shouldSuppressPreviewOnlyStatusCard(line('code', statusType, DOC))).toBe(false);
    },
  );
});

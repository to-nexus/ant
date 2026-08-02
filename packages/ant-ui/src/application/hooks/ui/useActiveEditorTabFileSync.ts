import { useEffect } from 'react';
import { useStore } from '@/domain/store';
import {
  UNPINNED_EDITOR_TAB_ID,
  shouldSyncActiveEditorTabFile,
} from '@/domain/store/editor/editorTabMainPanel';
import type { EditorTab } from '@/domain/store/types';

/**
 * Keeps `selectedFile` (the document-fetch SSOT in `fileSlice`) converged on
 * the active real editor tab.
 *
 * The two are written by different slices: `uiSlice` owns which tab is active,
 * `fileSlice` owns which document is fetched. Only the unpinned tab had a
 * reconciliation (`syncUnpinnedEditorTab`), so a PINNED tab could diverge with
 * no way back — `MainContentArea` renders the editor only while
 * `selectedFile === tab.path`, and the fetch effect lives inside that editor.
 * The result was a permanently blank preview that only unpinning fixed
 * (`unpinEditorTab` re-issues `openFile`).
 *
 * Streaming tabs are excluded: `VirtualDocumentViewer` owns those and renders
 * from the SSE buffer, not from a fetched file.
 */
export function useActiveEditorTabFileSync(activeEditorTab: EditorTab | undefined): void {
  const selectedFile = useStore((s) => s.selectedFile);
  const openFile = useStore((s) => s.openFile);

  // Depend on the identifying fields, not the tab object — `editorTabs` is
  // rebuilt on every buffer sync, so the object identity churns constantly.
  const tabId = activeEditorTab?.id;
  const tabPath = activeEditorTab?.path;
  const tabKind = activeEditorTab?.kind;
  const tabStatus = activeEditorTab?.status;

  useEffect(() => {
    if (!tabKind || !tabPath) return;
    if (!shouldSyncActiveEditorTabFile({ kind: tabKind, path: tabPath, status: tabStatus }, selectedFile)) {
      return;
    }
    void openFile(tabPath, { syncUnpinnedTab: tabId === UNPINNED_EDITOR_TAB_ID });
  }, [tabId, tabPath, tabKind, tabStatus, selectedFile, openFile]);
}

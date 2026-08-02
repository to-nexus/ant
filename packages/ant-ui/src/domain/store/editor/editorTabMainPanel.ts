import type { EditorTab, MainPanelTabId, MainPanelTabOrderItem } from '../types';

export const UNPINNED_EDITOR_TAB_ID = 'editor:unpinned' as const;

const STATIC_PANEL_TABS: ReadonlySet<string> = new Set([
  'projectConfig',
  'accountConfig',
  'transfer',
  'previewConfig',
  'actions',
]);

export const isEditorTabId = (tabId: string): tabId is `editor:${string}` =>
  tabId.startsWith('editor:');

export const fileTitleFromPath = (filePath: string | undefined): string =>
  filePath?.split('/').filter(Boolean).pop() || 'Untitled';

export const makePinnedRealTabId = (filePath: string): `editor:real:${string}` =>
  `editor:real:${filePath}`;

export const makeVirtualEditorTabId = (cardId: string): `editor:virtual:${string}` =>
  `editor:virtual:${cardId}`;

/** Report tabs get their own id namespace so they never collide with the
 *  streaming file-write virtual tabs minted by `makeVirtualEditorTabId`. */
export const makeReportEditorTabId = (cardId: string): `editor:report:${string}` =>
  `editor:report:${cardId}`;

/**
 * Whether `selectedFile` (the document-fetch SSOT) must be re-pointed at the
 * active tab. `uiSlice` owns the active tab, `fileSlice` owns `selectedFile`,
 * and only the UNPINNED tab had a reconciliation — a pinned tab could diverge
 * with nothing to converge it, leaving the preview blank until the user
 * unpinned. Streaming tabs are excluded: `VirtualDocumentViewer` renders those
 * from the SSE buffer, not from a fetched file.
 */
export function shouldSyncActiveEditorTabFile(
  tab: Pick<EditorTab, 'kind' | 'path' | 'status'> | undefined,
  selectedFile: string | undefined,
): boolean {
  if (!tab || tab.kind !== 'real' || !tab.path) return false;
  if (tab.status === 'streaming') return false;
  return selectedFile !== tab.path;
}

export function sanitizeEditorTabOrder(
  order: readonly string[],
  tabs: readonly EditorTab[],
): MainPanelTabOrderItem[] {
  const existingIds = new Set(tabs.map((tab) => tab.id));
  return order.filter((tab) => {
    if (isEditorTabId(tab)) return existingIds.has(tab);
    return STATIC_PANEL_TABS.has(tab);
  }) as MainPanelTabOrderItem[];
}

export function moveTabIdToOrderEnd<T extends string>(
  order: readonly T[],
  tabId: T,
): T[] {
  const next = order.filter((candidate) => candidate !== tabId);
  next.push(tabId);
  return next;
}

export function reconcileMainPanelActiveTab(args: {
  currentMainPanelActiveTab: MainPanelTabId;
  nextTabs: readonly EditorTab[];
  nextActiveEditorTabId: string | null;
}): MainPanelTabId {
  const { currentMainPanelActiveTab, nextTabs, nextActiveEditorTabId } = args;
  let nextMainActive = currentMainPanelActiveTab as string;

  if (isEditorTabId(nextMainActive) && !nextTabs.some((tab) => tab.id === nextMainActive)) {
    nextMainActive = nextActiveEditorTabId ?? 'job';
  }
  if ((nextMainActive === 'fileEdit' || isEditorTabId(nextMainActive)) && nextTabs.length === 0) {
    nextMainActive = 'job';
  }

  return nextMainActive as MainPanelTabId;
}

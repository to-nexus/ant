/**
 * Editor-tab ↔ document-fetch convergence.
 *
 * `uiSlice` owns which tab is active; `fileSlice.selectedFile` owns which
 * document is fetched. Only the UNPINNED tab had a reconciliation
 * (`syncUnpinnedEditorTab`), so a pinned tab could diverge with no way back:
 * `MainContentArea` mounts the editor only while `selectedFile === tab.path`,
 * and the fetch effect lives inside that editor. The preview stayed blank
 * until the user unpinned the tab (`unpinEditorTab` re-issues `openFile`).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { create } from 'zustand';

import { shouldSyncActiveEditorTabFile } from '../../src/domain/store/editor/editorTabMainPanel';
import { createFileSlice } from '../../src/domain/store/slices/fileSlice';
import { createUISlice } from '../../src/domain/store/slices/uiSlice';
import type { EditorTab } from '../../src/domain/store/types';

const apiMock = vi.hoisted(() => ({
  fetchFileContent: vi.fn(),
  fetchFileTree: vi.fn(),
  saveFileContent: vi.fn(),
  authFetch: vi.fn(),
  API_BASE: () => '',
}));
vi.mock('@/infrastructure/http/api', () => apiMock);

// `createUISlice` reads theme/language at construction and warns loudly when
// `localStorage` is absent. Stub it so the suite output stays readable.
beforeEach(() => {
  const m = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    get length() { return m.size; },
    key: (i: number) => Array.from(m.keys())[i] ?? null,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, String(v)); },
    removeItem: (k: string) => { m.delete(k); },
    clear: () => m.clear(),
  });
});

const tab = (over: Partial<EditorTab>): EditorTab =>
  ({ id: 'editor:real:plan/prd.md', title: 'prd.md', kind: 'real', pinned: true, readOnly: false, ...over } as EditorTab);

describe('shouldSyncActiveEditorTabFile — the active real tab drives the fetch', () => {
  it.each([
    ['pinned real tab diverged from selectedFile', tab({ path: 'plan/prd.md', status: 'ready' }), 'other.md', true],
    ['pinned real tab already converged', tab({ path: 'plan/prd.md', status: 'ready' }), 'plan/prd.md', false],
    ['nothing selected yet', tab({ path: 'plan/prd.md', status: 'ready' }), undefined, true],
    // VirtualDocumentViewer renders these from the SSE buffer, not from disk.
    ['streaming tab', tab({ path: 'plan/prd.md', status: 'streaming' }), undefined, false],
    ['virtual tab', tab({ kind: 'virtual', path: 'plan/prd.md', status: 'ready' }), undefined, false],
    ['pathless tab', tab({ path: undefined, status: 'ready' }), undefined, false],
    ['no active tab', undefined, 'plan/prd.md', false],
  ] as const)('%s → %s', (_label, activeTab, selectedFile, expected) => {
    expect(shouldSyncActiveEditorTabFile(activeTab, selectedFile)).toBe(expected);
  });
});

describe('setFileTree — repairs a document whose fetch errored', () => {
  beforeEach(() => {
    apiMock.fetchFileContent.mockReset();
  });

  const store = () =>
    create<any>((set, get) => ({
      ...createFileSlice(set as any, get as any, {} as any),
      selectedProject: 'proj',
      selectedFeature: 'base',
    }));

  const treeWith = (name: string) => [
    { name: 'plan', type: 'directory', children: [{ name, type: 'file', meta: { mtime: 42 } }] },
  ];

  it('retries once the file appears in the tree (data is null, so the mtime path cannot)', async () => {
    const s = store();
    apiMock.fetchFileContent.mockResolvedValue({
      projectId: 'proj', featureName: 'base', path: 'plan/prd.md', content: '# PRD', meta: { mtime: 42 },
    });
    s.setState({
      selectedFile: 'plan/prd.md',
      currentFile: { status: 'error', data: null, error: new Error('404'), refreshing: false, buffer: null, savingStatus: 'idle', saveError: null },
    });

    s.getState().setFileTree(treeWith('prd.md') as any);
    await vi.waitFor(() => expect(apiMock.fetchFileContent).toHaveBeenCalledWith('proj', 'base', 'plan/prd.md'));
  });

  it('does not retry while the file is still absent from the tree', () => {
    const s = store();
    s.setState({
      selectedFile: 'plan/prd.md',
      currentFile: { status: 'error', data: null, error: new Error('404'), refreshing: false, buffer: null, savingStatus: 'idle', saveError: null },
    });

    s.getState().setFileTree(treeWith('other.md') as any);
    expect(apiMock.fetchFileContent).not.toHaveBeenCalled();
  });

  it('leaves a healthy document alone', () => {
    const s = store();
    s.setState({
      selectedFile: 'plan/prd.md',
      currentFile: { status: 'ready', data: { path: 'plan/prd.md', content: '# PRD', meta: { mtime: 42 } }, error: null, refreshing: false, buffer: null, savingStatus: 'idle', saveError: null },
    });

    s.getState().setFileTree(treeWith('prd.md') as any);
    expect(apiMock.fetchFileContent).not.toHaveBeenCalled();
  });
});

describe('removeVirtualEditorTabsByJobId — streaming→ready repair survives', () => {
  const store = () =>
    create<any>((set, get) => ({
      ...createUISlice(set as any, get as any, {} as any),
      openFile: vi.fn(),
    }));

  it('applies the repair even when no virtual tab was filtered out', () => {
    // `.map` preserves length, so the old
    // `removedIds.size === 0 && nextTabs.length === tabs.length` early return
    // was always taken here and discarded the repair below.
    const s = store();
    s.setState({
      editorTabs: [tab({ id: 'editor:real:plan/prd.md', path: 'plan/prd.md', status: 'streaming', jobId: 'job-1', streamPreviewContent: 'partial' })],
      activeEditorTabId: 'editor:real:plan/prd.md',
      mainPanelActiveTab: 'editor:real:plan/prd.md',
      mainPanelTabOrder: ['editor:real:plan/prd.md'],
    });

    s.getState().removeVirtualEditorTabsByJobId('job-1');

    const [repaired] = s.getState().editorTabs as EditorTab[];
    expect(repaired.status).toBe('ready');
    expect(repaired.streamPreviewContent).toBeUndefined();
  });

  it('leaves tabs from other jobs untouched', () => {
    const s = store();
    s.setState({
      editorTabs: [tab({ id: 'editor:real:plan/prd.md', path: 'plan/prd.md', status: 'streaming', jobId: 'job-2' })],
      activeEditorTabId: 'editor:real:plan/prd.md',
      mainPanelActiveTab: 'editor:real:plan/prd.md',
      mainPanelTabOrder: ['editor:real:plan/prd.md'],
    });

    s.getState().removeVirtualEditorTabsByJobId('job-1');
    expect((s.getState().editorTabs as EditorTab[])[0].status).toBe('streaming');
  });
});

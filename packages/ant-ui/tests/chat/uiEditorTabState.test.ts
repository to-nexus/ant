import { describe, it, expect, vi } from 'vitest';
import { createUISlice } from '../../src/domain/store/slices/uiSlice';
import type { EditorTab } from '../../src/domain/store/types';

interface HarnessState extends ReturnType<typeof createUISlice> {
  selectedJobType: 'code' | 'design' | 'plan';
  chatEvents: any[];
  selectedFile: string | undefined;
  openFile: ReturnType<typeof vi.fn>;
  resetCurrentFile: ReturnType<typeof vi.fn>;
}

function createHarness(overrides: Partial<HarnessState> = {}) {
  let state = {} as HarnessState;
  const get = () => state;
  const set = (
    update: Partial<HarnessState> | ((current: HarnessState) => Partial<HarnessState>),
  ) => {
    const patch = typeof update === 'function' ? update(state) : update;
    state = { ...state, ...patch };
  };

  state = {
    ...createUISlice(set as any, get as any),
    selectedJobType: 'design',
    chatEvents: [],
    selectedFile: undefined,
    openFile: vi.fn(),
    resetCurrentFile: vi.fn(),
    ...overrides,
  } as HarnessState;

  return { get, set, state: () => state };
}

function makeRealTab(tab: Partial<EditorTab> & Pick<EditorTab, 'id' | 'title' | 'path'>): EditorTab {
  return {
    id: tab.id,
    title: tab.title,
    path: tab.path,
    kind: 'real',
    pinned: true,
    readOnly: false,
    status: 'ready',
    ...tab,
  };
}

describe('uiSlice editor tab transitions', () => {
  it('creates virtual tab from file streaming buffer only', () => {
    const h = createHarness({
      selectedJobType: 'design',
      chatEvents: [{ turnId: 'turn-1', jobType: 'design', jobId: 'job-1' }],
    } as Partial<HarnessState>);

    h.state().syncVirtualEditorTabsFromBuffers({
      'turn-1:_main_': {
        turnId: 'turn-1',
        pendingCards: {
          'card-1': {
            cardId: 'card-1',
            statusType: 'file_creating',
            metadata: { filePath: 'architecture/spec/spec-main.md' },
            streamedOutput: 'draft chunk',
          },
        },
      } as any,
    });

    expect(h.state().editorTabs).toHaveLength(1);
    expect(h.state().editorTabs[0]).toMatchObject({
      id: 'editor:virtual:card-1',
      kind: 'virtual',
      pinned: true,
      content: 'draft chunk',
      source: 'design',
      path: 'architecture/spec/spec-main.md',
    });
    expect(h.state().activeEditorTabId).toBe('editor:virtual:card-1');
    expect(h.state().mainPanelActiveTab).toBe('editor:virtual:card-1');
    expect(h.state().mainPanelOpenTabs.fileEdit).toBe(true);
    expect(h.state().mainPanelTabOrder).toContain('editor:virtual:card-1');
  });

  it('does not create virtual tab for plan_generating cards', () => {
    const h = createHarness({
      selectedJobType: 'plan',
      chatEvents: [{ turnId: 'turn-1', jobType: 'plan', jobId: 'job-1' }],
    } as Partial<HarnessState>);

    h.state().syncVirtualEditorTabsFromBuffers({
      'turn-1:_main_': {
        turnId: 'turn-1',
        pendingCards: {
          'card-1': {
            cardId: 'card-1',
            statusType: 'plan_generating',
            metadata: {},
            streamedOutput: 'outline',
          },
        },
      } as any,
    });

    expect(h.state().editorTabs).toHaveLength(0);
  });

  it('removes unpinned target when another unpinned tab exists', () => {
    const pinnedId = 'editor:pinned:docs/plan.md';
    const h = createHarness();
    h.set({
      editorTabs: [
        makeRealTab({
          id: 'editor:unpinned',
          title: 'notes.md',
          path: 'docs/notes.md',
          pinned: false,
        }),
        makeRealTab({ id: pinnedId, title: 'plan.md', path: 'docs/plan.md', pinned: true }),
      ],
      activeEditorTabId: pinnedId,
      mainPanelActiveTab: pinnedId,
      mainPanelOpenTabs: { ...h.state().mainPanelOpenTabs, fileEdit: true },
      mainPanelTabOrder: ['editor:unpinned', pinnedId],
    });

    h.state().unpinEditorTab(pinnedId);

    expect(h.state().editorTabs).toHaveLength(1);
    expect(h.state().editorTabs[0].id).toBe('editor:unpinned');
    expect(h.state().editorTabs[0].path).toBe('docs/notes.md');
  });

  it('converts pinned tab to default unpinned when no unpinned tab exists', () => {
    const pinnedId = 'editor:pinned:docs/spec.md';
    const h = createHarness();
    h.set({
      editorTabs: [
        makeRealTab({ id: pinnedId, title: 'spec.md', path: 'docs/spec.md', pinned: true }),
      ],
      activeEditorTabId: pinnedId,
      mainPanelActiveTab: pinnedId,
      mainPanelOpenTabs: { ...h.state().mainPanelOpenTabs, fileEdit: true },
      mainPanelTabOrder: [pinnedId],
    });

    h.state().unpinEditorTab(pinnedId);

    expect(h.state().editorTabs).toHaveLength(1);
    expect(h.state().editorTabs[0]).toMatchObject({
      id: 'editor:unpinned',
      path: 'docs/spec.md',
      pinned: false,
    });
    expect(h.state().activeEditorTabId).toBe('editor:unpinned');
    expect(h.state().mainPanelActiveTab).toBe('editor:unpinned');
  });

  it('blocks unpin while tab is streaming', () => {
    const pinnedId = 'editor:real:docs/spec.md';
    const h = createHarness();
    h.set({
      editorTabs: [
        makeRealTab({
          id: pinnedId,
          title: 'spec.md',
          path: 'docs/spec.md',
          pinned: true,
          status: 'streaming',
        }),
      ],
      activeEditorTabId: pinnedId,
      mainPanelActiveTab: pinnedId,
      mainPanelOpenTabs: { ...h.state().mainPanelOpenTabs, fileEdit: true },
      mainPanelTabOrder: [pinnedId],
    });

    h.state().unpinEditorTab(pinnedId);

    expect(h.state().editorTabs).toHaveLength(1);
    expect(h.state().editorTabs[0]).toMatchObject({
      id: pinnedId,
      pinned: true,
      status: 'streaming',
    });
  });

  it('selectEditorTab activates top-level tab id and updates order', () => {
    const unpinned = makeRealTab({
      id: 'editor:unpinned',
      title: 'a.md',
      path: 'docs/a.md',
      pinned: false,
    });
    const pinned = makeRealTab({
      id: 'editor:pinned:docs/b.md',
      title: 'b.md',
      path: 'docs/b.md',
      pinned: true,
    });
    const h = createHarness({
      editorTabs: [unpinned, pinned],
      activeEditorTabId: unpinned.id,
      mainPanelActiveTab: unpinned.id,
      mainPanelOpenTabs: {
        projectConfig: false,
        accountConfig: false,
        fileEdit: true,
        transfer: false,
        previewConfig: false,
        actions: false,
      },
      mainPanelTabOrder: [unpinned.id, pinned.id],
    } as Partial<HarnessState>);

    h.state().selectEditorTab(pinned.id);

    expect(h.state().activeEditorTabId).toBe(pinned.id);
    expect(h.state().mainPanelActiveTab).toBe(pinned.id);
    expect(h.state().mainPanelTabOrder[h.state().mainPanelTabOrder.length - 1]).toBe(pinned.id);
  });
});

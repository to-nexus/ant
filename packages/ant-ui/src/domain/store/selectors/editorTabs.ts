import type { EditorTab } from '../types';

export function selectActiveEditorTab(state: {
  mainPanelActiveTab: string;
  activeEditorTabId: string | null;
  editorTabs: EditorTab[];
}): EditorTab | undefined {
  return (
    state.editorTabs.find((tab) => tab.id === state.mainPanelActiveTab) ??
    state.editorTabs.find((tab) => tab.id === state.activeEditorTabId)
  );
}

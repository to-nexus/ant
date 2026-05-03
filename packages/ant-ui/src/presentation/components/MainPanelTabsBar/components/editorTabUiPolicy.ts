import type { EditorTab } from '@/domain/store/types';

export interface EditorTabActionPolicy {
  isStreaming: boolean;
  showPinToggle: boolean;
  showCloseButton: boolean;
}

export function getEditorTabActionPolicy(tab: Pick<EditorTab, 'pinned' | 'status'>): EditorTabActionPolicy {
  const isStreaming = tab.status === 'streaming';
  return {
    isStreaming,
    showPinToggle: !isStreaming,
    showCloseButton: !tab.pinned,
  };
}

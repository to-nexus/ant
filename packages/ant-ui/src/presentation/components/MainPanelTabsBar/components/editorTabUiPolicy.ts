import type { EditorTab } from '@/domain/store/types';

export interface EditorTabActionPolicy {
  isStreaming: boolean;
  showPinToggle: boolean;
  showCloseButton: boolean;
}

export function getEditorTabActionPolicy(
  tab: Pick<EditorTab, 'kind' | 'pinned' | 'status'>,
): EditorTabActionPolicy {
  const isStreaming = tab.status === 'streaming';
  // `pinned` means two different things per `kind`. On a REAL tab it is a slot
  // concept — pinned = dedicated path-keyed tab, unpinned = the single shared
  // preview slot — so pin/unpin are path-based slot migrations that both store
  // actions guard with `kind !== 'real'`. On a VIRTUAL tab `pinned: true` is
  // only a "not the preview slot" marker with no unpinned counterpart, so it
  // must neither advertise the (no-op) toggle nor suppress close.
  const isVirtual = tab.kind === 'virtual';
  return {
    isStreaming,
    showPinToggle: !isStreaming && !isVirtual,
    // Streaming virtual tabs stay non-closable: the buffer sync would recreate
    // and re-focus them on the next snapshot, so closing would visibly fail.
    showCloseButton: isVirtual ? !isStreaming : !tab.pinned,
  };
}

import { Pin, PinOff, X } from 'lucide-react';
import type { EditorTab } from '@/domain/store/types';
import { StreamingSpinner } from '@/presentation/components/streaming/StreamingStatusChip';
import { getEditorTabActionPolicy } from './editorTabUiPolicy';

interface EditorTabActionsProps {
  tab: EditorTab;
  pinTitle: string;
  unpinTitle: string;
  closeTitle: string;
  streamingTitle: string;
  onPin: () => void;
  onUnpin: () => void;
  onClose: () => void;
}

export function EditorTabActions({
  tab,
  pinTitle,
  unpinTitle,
  closeTitle,
  streamingTitle,
  onPin,
  onUnpin,
  onClose,
}: EditorTabActionsProps) {
  const policy = getEditorTabActionPolicy(tab);

  return (
    <div className="flex items-center gap-1">
      {policy.isStreaming ? (
        <span
          title={streamingTitle}
          className="inline-flex items-center justify-center rounded p-1 bg-amber-100 dark:bg-amber-900/30"
        >
          <StreamingSpinner className="w-3 h-3" />
        </span>
      ) : (
        <button
          type="button"
          className="p-1 rounded hover:bg-gray-200 dark:hover:bg-[#30363d]"
          title={tab.pinned ? unpinTitle : pinTitle}
          onClick={(event) => {
            event.stopPropagation();
            if (tab.pinned) onUnpin();
            else onPin();
          }}
        >
          {tab.pinned ? <PinOff className="w-3 h-3" /> : <Pin className="w-3 h-3" />}
        </button>
      )}

      {policy.showCloseButton && (
        <button
          type="button"
          className="p-1 rounded hover:bg-gray-200 dark:hover:bg-[#30363d]"
          title={closeTitle}
          onClick={(event) => {
            event.stopPropagation();
            onClose();
          }}
        >
          <X className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}

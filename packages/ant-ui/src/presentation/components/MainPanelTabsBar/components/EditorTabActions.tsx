import { useState } from 'react';
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
  const [pinHover, setPinHover] = useState(false);
  const [closeHover, setCloseHover] = useState(false);

  return (
    <div className="flex items-center gap-0.5">
      {policy.isStreaming ? (
        <span
          title={streamingTitle}
          className="inline-flex items-center justify-center rounded p-1"
          style={{ background: 'oklch(from var(--warning-fg) l c h / 0.16)' }}
        >
          <StreamingSpinner className="w-3 h-3" />
        </span>
      ) : (
        <button
          type="button"
          className="p-1 rounded"
          style={{ background: pinHover ? 'var(--bg-hover)' : 'transparent' }}
          title={tab.pinned ? unpinTitle : pinTitle}
          onMouseEnter={() => setPinHover(true)}
          onMouseLeave={() => setPinHover(false)}
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
          className="p-1 rounded"
          style={{ background: closeHover ? 'var(--bg-hover)' : 'transparent' }}
          title={closeTitle}
          onMouseEnter={() => setCloseHover(true)}
          onMouseLeave={() => setCloseHover(false)}
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

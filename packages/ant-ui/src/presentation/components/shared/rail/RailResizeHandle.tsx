import type { MouseEvent } from 'react';

/** 4px drag handle on a rail's right border; violet while hovered or dragging. */
export function RailResizeHandle({ isResizing, onMouseDown }: { isResizing: boolean; onMouseDown: (e: MouseEvent) => void }) {
  return (
    <div
      className="absolute top-0 right-0 h-full"
      style={{
        width: 4,
        marginRight: -2,
        cursor: 'ew-resize',
        zIndex: 10,
        background: isResizing ? 'var(--violet-400)' : 'transparent',
      }}
      onMouseDown={onMouseDown}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLDivElement).style.background = 'var(--violet-400)';
      }}
      onMouseLeave={(e) => {
        if (!isResizing) (e.currentTarget as HTMLDivElement).style.background = 'transparent';
      }}
    />
  );
}

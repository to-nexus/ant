import type { MouseEvent } from 'react';

/** 4px drag handle on a rail's border (right by default, `side="left"` for a right-docked drawer); violet while hovered or dragging. */
export function RailResizeHandle({ isResizing, onMouseDown, side = 'right' }: { isResizing: boolean; onMouseDown: (e: MouseEvent) => void; side?: 'left' | 'right' }) {
  return (
    <div
      className={`absolute top-0 h-full ${side === 'left' ? 'left-0' : 'right-0'}`}
      style={{
        width: 4,
        ...(side === 'left' ? { marginLeft: -2 } : { marginRight: -2 }),
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

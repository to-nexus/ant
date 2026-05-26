import { useEffect, useLayoutEffect, useRef, useState, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { MoreHorizontal } from 'lucide-react';

export interface BadgeOverflowItem {
  key: string;
  node: ReactElement;
}

interface BadgeOverflowRowProps {
  pinned: BadgeOverflowItem[];
  overflowable: BadgeOverflowItem[];
  className?: string;
}

const GAP_PX = 6;
const MORE_CHIP_RESERVE_PX = 56;

export function BadgeOverflowRow({ pinned, overflowable, className = '' }: BadgeOverflowRowProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [visibleCount, setVisibleCount] = useState(overflowable.length);
  const [popoverOpen, setPopoverOpen] = useState(false);

  const overflowKeys = overflowable.map(i => i.key).join('|');

  useLayoutEffect(() => {
    const container = containerRef.current;
    const measure = measureRef.current;
    if (!container || !measure) return;

    const recompute = () => {
      const containerWidth = container.clientWidth;
      if (containerWidth === 0) return;
      const nodes = Array.from(measure.children) as HTMLElement[];
      const pinnedNodes = nodes.slice(0, pinned.length);
      const overflowNodes = nodes.slice(pinned.length);

      const pinnedWidth = pinnedNodes.reduce(
        (sum, el, idx) => sum + el.offsetWidth + (idx > 0 ? GAP_PX : 0),
        0,
      );

      if (pinnedWidth >= containerWidth) {
        setVisibleCount(0);
        return;
      }

      let used = pinnedWidth;
      let count = 0;
      for (let i = 0; i < overflowNodes.length; i++) {
        const w = overflowNodes[i].offsetWidth;
        const remaining = overflowNodes.length - count - 1;
        const reserve = remaining > 0 ? MORE_CHIP_RESERVE_PX : 0;
        const next = used + (count === 0 && pinnedNodes.length === 0 ? 0 : GAP_PX) + w;
        if (next <= containerWidth - reserve) {
          used = next;
          count++;
        } else {
          break;
        }
      }
      setVisibleCount(count);
    };

    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(container);
    return () => ro.disconnect();
  }, [pinned.length, overflowable.length, overflowKeys]);

  useEffect(() => {
    if (visibleCount >= overflowable.length && popoverOpen) {
      setPopoverOpen(false);
    }
  }, [visibleCount, overflowable.length, popoverOpen]);

  if (pinned.length === 0 && overflowable.length === 0) return null;

  const visibleOverflow = overflowable.slice(0, visibleCount);
  const hiddenOverflow = overflowable.slice(visibleCount);
  const hiddenCount = hiddenOverflow.length;

  return (
    <div className={`relative ${className}`}>
      <div
        ref={measureRef}
        aria-hidden
        className="absolute -top-[9999px] left-0 flex items-center gap-1.5 invisible pointer-events-none"
      >
        {pinned.map(item => (
          <span key={`m-${item.key}`}>{item.node}</span>
        ))}
        {overflowable.map(item => (
          <span key={`m-${item.key}`}>{item.node}</span>
        ))}
      </div>

      <div ref={containerRef} className="flex items-center gap-1.5 overflow-hidden">
        {pinned.map(item => (
          <span key={item.key}>{item.node}</span>
        ))}
        {visibleOverflow.map(item => (
          <span key={item.key}>{item.node}</span>
        ))}
        {hiddenCount > 0 && (
          <button
            ref={triggerRef}
            type="button"
            onClick={() => setPopoverOpen(v => !v)}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--bg-hover)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'var(--bg-surface-2)';
            }}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium transition-colors"
            style={{
              background: 'var(--bg-surface-2)',
              border: '1px solid var(--border-1)',
              color: 'var(--text-2)',
            }}
            aria-label={`Show ${hiddenCount} more`}
          >
            <MoreHorizontal className="w-3 h-3" />
            <span>+{hiddenCount}</span>
          </button>
        )}
      </div>

      {popoverOpen && hiddenCount > 0 && (
        <OverflowPopover
          anchorRef={triggerRef}
          items={hiddenOverflow}
          onClose={() => setPopoverOpen(false)}
        />
      )}
    </div>
  );
}

interface OverflowPopoverProps {
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  items: BadgeOverflowItem[];
  onClose: () => void;
}

type Placement = 'top' | 'bottom' | 'left' | 'right';

interface PopoverGeometry {
  top: number;
  left: number;
  maxHeight: number;
  maxWidth: number;
  placement: Placement;
}

function OverflowPopover({ anchorRef, items, onClose }: OverflowPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [geom, setGeom] = useState<PopoverGeometry | null>(null);

  useLayoutEffect(() => {
    const update = () => {
      const anchor = anchorRef.current;
      const popover = popoverRef.current;
      if (!anchor || !popover) return;
      const aRect = anchor.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const margin = 8;
      const gap = 6;
      const preferredWidth = 420;
      const minSidePanel = 240;

      const spaceTop = aRect.top - margin - gap;
      const spaceBottom = vh - aRect.bottom - margin - gap;
      const spaceLeft = aRect.left - margin - gap;
      const spaceRight = vw - aRect.right - margin - gap;

      // Prefer vertical placement; fall back to horizontal only when neither
      // vertical band has room AND a side has at least minSidePanel px free.
      const vertBest = Math.max(spaceTop, spaceBottom);
      const horizBest = Math.max(spaceLeft, spaceRight);
      const useVertical = vertBest >= 160 || horizBest < minSidePanel;

      let placement: Placement;
      let maxHeight: number;
      let maxWidth: number;
      let top: number;
      let left: number;

      if (useVertical) {
        placement = spaceBottom >= spaceTop ? 'bottom' : 'top';
        maxHeight = Math.max(120, placement === 'bottom' ? spaceBottom : spaceTop);
        maxWidth = Math.min(preferredWidth, vw - margin * 2);

        // Measure rendered popover (it has max constraints applied from prev pass)
        const pRect = popover.getBoundingClientRect();
        const popW = Math.min(pRect.width, maxWidth);
        top = placement === 'bottom' ? aRect.bottom + gap : aRect.top - gap - Math.min(pRect.height, maxHeight);
        left = aRect.left;
        const maxLeft = vw - popW - margin;
        if (left > maxLeft) left = Math.max(margin, maxLeft);
        if (left < margin) left = margin;
      } else {
        placement = spaceRight >= spaceLeft ? 'right' : 'left';
        maxWidth = Math.min(preferredWidth, placement === 'right' ? spaceRight : spaceLeft);
        maxHeight = Math.max(120, vh - margin * 2);

        const pRect = popover.getBoundingClientRect();
        const popH = Math.min(pRect.height, maxHeight);
        left = placement === 'right' ? aRect.right + gap : aRect.left - gap - Math.min(pRect.width, maxWidth);
        top = aRect.top + aRect.height / 2 - popH / 2;
        const maxTop = vh - popH - margin;
        if (top > maxTop) top = Math.max(margin, maxTop);
        if (top < margin) top = margin;
      }

      setGeom({ top, left, maxHeight, maxWidth, placement });
    };

    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [anchorRef, items.length]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (popoverRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      onClose();
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 0);
    document.addEventListener('keydown', handleEscape);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [anchorRef, onClose]);

  return createPortal(
    <div
      ref={popoverRef}
      style={{
        position: 'fixed',
        top: geom?.top ?? -9999,
        left: geom?.left ?? -9999,
        maxHeight: geom?.maxHeight ?? 'min(420px, calc(100vh - 16px))',
        maxWidth: geom?.maxWidth ?? 'min(420px, calc(100vw - 16px))',
        zIndex: 9999,
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-1)',
      }}
      className="rounded-lg shadow-xl flex flex-col overflow-hidden"
      role="dialog"
      data-placement={geom?.placement}
    >
      <div className="flex flex-wrap gap-1.5 p-2 overflow-y-auto">
        {items.map(item => (
          <span key={item.key}>{item.node}</span>
        ))}
      </div>
    </div>,
    document.body,
  );
}

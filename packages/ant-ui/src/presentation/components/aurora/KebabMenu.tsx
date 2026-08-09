/**
 * Aurora KebabMenu — generic "⋯" dropdown for row-level actions.
 *
 * Portal-rendered (document.body) so parent overflow containers never clip
 * it; viewport flip logic + outside-click/scroll/resize close are the same
 * battle-tested core as FileActionMenu, generalized to an `items` array.
 * `confirm: true` items arm on first click (label swaps to `confirmLabel`,
 * menu stays open) and execute on the second — the house two-click-arm
 * pattern adapted to a menu.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MoreHorizontal } from 'lucide-react';
import { cn } from '@/shared/utils/design-system';

export type KebabMenuItem =
  | {
      icon: React.ElementType;
      label: string;
      onClick: () => void;
      variant?: 'danger';
      /** Two-click arm: first click swaps the label to confirmLabel, second executes. */
      confirm?: boolean;
      confirmLabel?: string;
    }
  | 'separator';

export function KebabMenu({
  items,
  ariaLabel,
  className,
}: {
  items: KebabMenuItem[];
  ariaLabel?: string;
  className?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [armedIndex, setArmedIndex] = useState<number | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  const close = useCallback(() => {
    setIsOpen(false);
    setArmedIndex(null);
  }, []);

  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const GAP = 4;
    const MENU_WIDTH = 172;
    let left = rect.right + GAP;
    if (left + MENU_WIDTH > window.innerWidth - 8) left = rect.left - MENU_WIDTH - GAP;
    if (left < 8) left = 8;
    const estimatedHeight = items.reduce((h, item) => h + (item === 'separator' ? 9 : 32), 8);
    let top = rect.top;
    if (top + estimatedHeight > window.innerHeight - 8) {
      top = rect.bottom - estimatedHeight;
      if (top < 8) top = 8;
    }
    setMenuPos({ top, left });
  }, [items]);

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        menuRef.current && !menuRef.current.contains(e.target as Node) &&
        triggerRef.current && !triggerRef.current.contains(e.target as Node)
      ) {
        close();
      }
    };
    const handleScroll = (e: Event) => {
      if (triggerRef.current && e.target instanceof Node && (e.target as Node).contains(triggerRef.current)) {
        close();
      }
    };
    const handleResize = () => close();
    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('resize', handleResize);
    const rafId = requestAnimationFrame(() => {
      document.addEventListener('scroll', handleScroll, true);
    });
    return () => {
      cancelAnimationFrame(rafId);
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', handleResize);
    };
  }, [isOpen, close]);

  if (items.length === 0) return null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={ariaLabel}
        className={cn(
          'inline-flex items-center justify-center h-5 w-5 rounded text-[color:var(--text-3)] hover:text-[color:var(--text-2)] hover:bg-[color:var(--bg-active)]',
          className,
        )}
        onClick={(e) => {
          e.stopPropagation();
          if (!isOpen) updatePosition();
          setIsOpen((prev) => !prev);
          setArmedIndex(null);
        }}
      >
        <MoreHorizontal className="w-3.5 h-3.5" />
      </button>

      {isOpen &&
        createPortal(
          <div
            ref={menuRef}
            className="fixed z-[9999] min-w-[172px] rounded-md border border-[color:var(--border-1)] bg-[color:var(--bg-surface)] shadow-lg py-1 animate-in fade-in-0 zoom-in-95 duration-100"
            style={{ top: menuPos.top, left: menuPos.left }}
          >
            {items.map((item, index) => {
              if (item === 'separator') {
                return <div key={`sep-${index}`} className="my-1 border-t border-[color:var(--border-1)]" />;
              }
              const Icon = item.icon;
              const isDanger = item.variant === 'danger';
              const armed = armedIndex === index;
              return (
                <button
                  key={`${item.label}-${index}`}
                  type="button"
                  className={cn(
                    'flex items-center gap-2 w-full px-3 py-1.5 text-xs text-left transition-colors',
                    isDanger
                      ? 'text-[color:var(--status-error-fg)] hover:bg-[color:var(--bg-hover)]'
                      : 'text-[color:var(--text-2)] hover:bg-[color:var(--bg-hover)]',
                    armed && 'font-semibold',
                  )}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (item.confirm && !armed) {
                      setArmedIndex(index);
                      return;
                    }
                    close();
                    item.onClick();
                  }}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {armed ? (item.confirmLabel ?? item.label) : item.label}
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
}

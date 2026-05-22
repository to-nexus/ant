import { useRef, useEffect, useCallback, type WheelEvent } from 'react';
import { ChevronLeft } from 'lucide-react';

// ============================================
// Types
// ============================================

export interface TabItem {
  id: string;
  label: string;
  description: string;
  icon?: React.ComponentType<{ className?: string }>;
  iconBg?: string;
  iconColor?: string;
}

interface ScrollableTabNavProps {
  items: readonly TabItem[];
  selectedId: string;
  onSelect: (id: string) => void;
  onBack: () => void;
}

// ============================================
// Main Component
// ============================================

export function ScrollableTabNav({ items, selectedId, onSelect, onBack }: ScrollableTabNavProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLButtonElement>(null);

  const scrollToSelected = useCallback(() => {
    if (!selectedRef.current || !scrollRef.current) return;
    selectedRef.current.scrollIntoView({
      behavior: 'smooth',
      inline: 'center',
      block: 'nearest',
    });
  }, []);

  useEffect(() => {
    requestAnimationFrame(scrollToSelected);
  }, [selectedId, scrollToSelected]);

  const isSingle = items.length <= 1;
  const hasIcons = items.some(i => i.icon);

  const handleWheel = useCallback((e: WheelEvent<HTMLDivElement>) => {
    const el = scrollRef.current;
    if (!el) return;
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    }
  }, []);

  return (
    <div className="flex items-start gap-2">
      {/* Back button */}
      <button
        type="button"
        onClick={onBack}
        className="p-2 mt-0.5 -ml-1 rounded-lg transition-colors shrink-0"
        style={{ color: 'var(--text-3)' }}
        aria-label="Back"
      >
        <ChevronLeft className="w-6 h-6" />
      </button>

      {/* Tab strip */}
      {isSingle ? (
        <SingleTab item={items[0]} />
      ) : (
        <div className="relative flex-1 min-w-0">
          <div
            ref={scrollRef}
            onWheel={handleWheel}
            className="flex items-stretch gap-1 overflow-x-auto scrollbar-hide scroll-smooth"
          >
            {items.map(item => {
              const isSelected = item.id === selectedId;
              const ItemIcon = item.icon;
              return (
                <button
                  key={item.id}
                  ref={isSelected ? selectedRef : undefined}
                  type="button"
                  onClick={() => !isSelected && onSelect(item.id)}
                  className="shrink-0 px-3 py-1.5 rounded-lg text-left transition-all duration-200"
                  style={{
                    background: isSelected ? 'var(--bg-surface-2)' : 'transparent',
                    cursor: isSelected ? 'default' : 'pointer',
                  }}
                >
                  <span className="flex items-center gap-1.5">
                    {hasIcons && ItemIcon && (
                      <span className={`w-5 h-5 rounded flex items-center justify-center shrink-0 ${
                        isSelected ? (item.iconBg || '') : ''
                      }`}>
                        <ItemIcon
                          className={`w-3 h-3 transition-colors duration-200 ${
                            isSelected ? (item.iconColor || '') : ''
                          }`}
                        />
                      </span>
                    )}
                    <span
                      className="text-sm whitespace-nowrap transition-colors duration-200"
                      style={{
                        color: isSelected ? 'var(--text-1)' : 'var(--text-3)',
                        fontWeight: isSelected ? 600 : 400,
                      }}
                    >
                      {item.label}
                    </span>
                  </span>
                  {isSelected && (
                    <span
                      className="block text-xs mt-0.5 whitespace-nowrap"
                      style={{ color: 'var(--text-3)' }}
                    >
                      {item.description}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <FadeEdges scrollRef={scrollRef} />
        </div>
      )}
    </div>
  );
}

// ============================================
// Sub-components
// ============================================

function SingleTab({ item }: { item: TabItem }) {
  const ItemIcon = item.icon;
  return (
    <div className="flex items-center gap-2 min-w-0">
      {ItemIcon && (
        <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${item.iconBg || ''}`}>
          <ItemIcon className={`w-3.5 h-3.5 ${item.iconColor || ''}`} />
        </div>
      )}
      <div className="min-w-0">
        <h2 className="text-base font-semibold truncate" style={{ color: 'var(--text-1)' }}>
          {item.label}
        </h2>
        <p className="text-xs truncate" style={{ color: 'var(--text-3)' }}>
          {item.description}
        </p>
      </div>
    </div>
  );
}

function FadeEdges({ scrollRef }: { scrollRef: React.RefObject<HTMLDivElement | null> }) {
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);

  const update = useCallback(() => {
    const el = scrollRef.current;
    if (!el || !leftRef.current || !rightRef.current) return;
    const { scrollLeft, scrollWidth, clientWidth } = el;
    leftRef.current.style.opacity = scrollLeft > 4 ? '1' : '0';
    rightRef.current.style.opacity = scrollLeft + clientWidth < scrollWidth - 4 ? '1' : '0';
  }, [scrollRef]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', update);
      ro.disconnect();
    };
  }, [scrollRef, update]);

  return (
    <>
      <div
        ref={leftRef}
        className="pointer-events-none absolute left-0 top-0 bottom-0 w-6 transition-opacity duration-150"
        style={{
          opacity: 0,
          background: 'linear-gradient(to right, var(--bg-app), transparent)',
        }}
      />
      <div
        ref={rightRef}
        className="pointer-events-none absolute right-0 top-0 bottom-0 w-6 transition-opacity duration-150"
        style={{
          opacity: 0,
          background: 'linear-gradient(to left, var(--bg-app), transparent)',
        }}
      />
    </>
  );
}

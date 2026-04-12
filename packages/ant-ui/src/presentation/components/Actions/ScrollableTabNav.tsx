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
        className="p-2 mt-0.5 -ml-1 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors shrink-0"
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
                  className={`
                    shrink-0 px-3 py-1.5 rounded-lg text-left transition-all duration-200
                    ${isSelected
                      ? 'bg-gray-100 dark:bg-gray-800'
                      : 'hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-pointer'}
                  `}
                >
                  <span className="flex items-center gap-1.5">
                    {hasIcons && ItemIcon && (
                      <span className={`w-5 h-5 rounded flex items-center justify-center shrink-0 ${
                        isSelected ? (item.iconBg || '') : ''
                      }`}>
                        <ItemIcon className={`w-3 h-3 transition-colors duration-200 ${
                          isSelected
                            ? (item.iconColor || 'text-gray-600 dark:text-gray-300')
                            : 'text-gray-300 dark:text-gray-600'
                        }`} />
                      </span>
                    )}
                    <span
                      className={`text-sm whitespace-nowrap transition-colors duration-200 ${
                        isSelected
                          ? 'font-semibold text-gray-900 dark:text-white'
                          : 'font-normal text-gray-400 dark:text-gray-500'
                      }`}
                    >
                      {item.label}
                    </span>
                  </span>
                  <span className={`block text-xs mt-0.5 whitespace-nowrap ${
                    isSelected
                      ? 'text-gray-500 dark:text-gray-400'
                      : 'hidden'
                  }`}>
                    {item.description}
                  </span>
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
        <h2 className="text-base font-semibold text-gray-900 dark:text-white truncate">
          {item.label}
        </h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
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
        className="pointer-events-none absolute left-0 top-0 bottom-0 w-6 bg-gradient-to-r from-white dark:from-[#161b22] to-transparent transition-opacity duration-150"
        style={{ opacity: 0 }}
      />
      <div
        ref={rightRef}
        className="pointer-events-none absolute right-0 top-0 bottom-0 w-6 bg-gradient-to-l from-white dark:from-[#161b22] to-transparent transition-opacity duration-150"
        style={{ opacity: 0 }}
      />
    </>
  );
}

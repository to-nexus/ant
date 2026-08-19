import { useRef, useEffect, useState, useCallback, type WheelEvent } from 'react';
import { ChevronLeft, Info } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Tooltip } from '@/presentation/components/common/Tooltip';

// ============================================
// Types
// ============================================

/** Upper bound on a tab's width — a long description must never push its siblings out of the strip. */
const TAB_MAX_WIDTH = 260;

export interface TabItem {
  id: string;
  label: string;
  /**
   * Optional one-line subtitle. Supply it ONLY for real, human-facing UI copy
   * (the localized canonical action/intent descriptions). Universal surfaces
   * pass nothing: a custom job has no description by design
   * (`CustomJobSummary`), and `CustomIntentDef.infer` is the `infer.md`
   * inference criterion — prompt text rendered into the Intent Catalog every
   * turn, already shown in full by the intent detail body.
   */
  description?: string;
  icon?: React.ComponentType<{ className?: string }>;
  iconBg?: string;
  iconColor?: string;
}

interface ScrollableTabNavProps {
  items: readonly TabItem[];
  selectedId: string;
  onSelect: (id: string) => void;
  onBack: () => void;
  /** Optional right-aligned accessory rendered at the end of the header row. */
  rightAccessory?: React.ReactNode;
}

// ============================================
// Main Component
// ============================================

export function ScrollableTabNav({ items, selectedId, onSelect, onBack, rightAccessory }: ScrollableTabNavProps) {
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
            {items.map(item => (
              <Tab
                key={item.id}
                item={item}
                isSelected={item.id === selectedId}
                hasIcons={hasIcons}
                selectedRef={selectedRef}
                onSelect={onSelect}
              />
            ))}
          </div>
          <FadeEdges scrollRef={scrollRef} />
        </div>
      )}

      {rightAccessory && (
        <div className="ml-auto shrink-0 pt-0.5">{rightAccessory}</div>
      )}
    </div>
  );
}

// ============================================
// Sub-components
// ============================================

/**
 * True while the element's text is visually clipped by `truncate`. Measured
 * rather than estimated — the same `scrollWidth > clientWidth` probe used by
 * `TruncatableText` and the chat `FileCard` header.
 */
function useIsClipped(ref: React.RefObject<HTMLElement | null>, text: string | undefined): boolean {
  const [clipped, setClipped] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || !text) {
      setClipped(false);
      return;
    }
    const measure = () => setClipped(el.scrollWidth > el.clientWidth + 1);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, text]);

  return clipped;
}

interface TabProps {
  item: TabItem;
  isSelected: boolean;
  hasIcons: boolean;
  selectedRef: React.RefObject<HTMLButtonElement | null>;
  onSelect: (id: string) => void;
}

function Tab({ item, isSelected, hasIcons, selectedRef, onSelect }: TabProps) {
  const { t } = useTranslation('actions');
  const ItemIcon = item.icon;
  const descRef = useRef<HTMLSpanElement>(null);
  const hasDescription = Boolean(item.description);
  const isDescClipped = useIsClipped(descRef, isSelected ? item.description : undefined);

  return (
    <button
      ref={isSelected ? selectedRef : undefined}
      type="button"
      onClick={() => !isSelected && onSelect(item.id)}
      className="shrink-0 min-w-0 px-3 py-1.5 rounded-lg text-left transition-all duration-200"
      style={{
        maxWidth: TAB_MAX_WIDTH,
        background: isSelected ? 'var(--bg-surface)' : 'transparent',
        color: isSelected ? 'var(--violet-700)' : 'var(--text-3)',
        border: isSelected
          ? '1px solid var(--violet-200)'
          : '1px solid transparent',
        boxShadow: isSelected ? 'var(--shadow-xs)' : undefined,
        cursor: isSelected ? 'default' : 'pointer',
      }}
    >
      <span className="flex items-center gap-1.5 min-w-0">
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
          className="text-sm truncate transition-colors duration-200"
          style={{
            color: isSelected ? 'inherit' : 'var(--text-3)',
            fontWeight: isSelected ? 600 : 400,
          }}
        >
          {item.label}
        </span>
      </span>
      {isSelected && hasDescription && (
        <span className="flex items-center gap-1 mt-0.5 min-w-0">
          <span
            ref={descRef}
            className="text-xs truncate min-w-0"
            style={{ color: 'var(--text-3)' }}
          >
            {item.description}
          </span>
          {isDescClipped && (
            /* Only the icon is wrapped, never the tab button: Tooltip's trigger
               wrapper hardcodes `inline-flex; align-items:center`, which would
               break the strip's equal-height rows and remount the button (and
               with it `selectedRef`) whenever the clip state flips. */
            <Tooltip content={item.description} trigger="hover" placement="bottom">
              <span
                role="button"
                tabIndex={0}
                className="inline-flex shrink-0 cursor-help"
                aria-label={t('tabDescriptionFull', { defaultValue: 'Show full description' })}
              >
                <Info className="w-3 h-3" style={{ color: 'var(--text-4)' }} />
              </span>
            </Tooltip>
          )}
        </span>
      )}
    </button>
  );
}

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
        {item.description && (
          <p className="text-xs truncate" style={{ color: 'var(--text-3)' }}>
            {item.description}
          </p>
        )}
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

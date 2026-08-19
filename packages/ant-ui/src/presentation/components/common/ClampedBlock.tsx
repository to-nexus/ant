/**
 * ClampedBlock — content shown in full up to `maxHeight`, then clamped with a
 * fade and an expand/collapse toggle.
 *
 * The toggle exists ONLY when the content actually overflows: a short body must
 * not carry a "Show more" affordance that expands nothing. Overflow is measured
 * (scrollHeight vs maxHeight), never guessed from character counts — the same
 * reason `TruncatableText` grew its `overflowAware` mode, generalized here to
 * multi-line bodies (prose, markdown, row lists) instead of one-line paths.
 *
 * Expanded means "grow in place": the surrounding panel already scrolls, so an
 * inner scrollbar would trap the wheel.
 */

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronUp } from 'lucide-react';

export interface ClampedBlockProps {
  /** Collapsed height cap in px. */
  maxHeight: number;
  /** Background the bottom fade blends into (must match the container's). */
  fadeColor?: string;
  children: React.ReactNode;
}

export function ClampedBlock({ maxHeight, fadeColor = 'var(--bg-surface)', children }: ClampedBlockProps) {
  const { t } = useTranslation('common');
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    // No ResizeObserver (jsdom, old engines): show everything rather than clamp
    // content behind a toggle we cannot decide the need for.
    if (typeof ResizeObserver === 'undefined') {
      setOverflows(false);
      return;
    }
    const measure = () => setOverflows(el.scrollHeight > maxHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [maxHeight, children]);

  const clamped = overflows && !expanded;

  return (
    <div className="flex flex-col min-w-0">
      <div className="relative min-w-0">
        <div
          ref={contentRef}
          style={{ maxHeight: clamped ? maxHeight : 'none', overflow: 'hidden' }}
        >
          {children}
        </div>
        {clamped && (
          <div
            aria-hidden
            className="absolute inset-x-0 bottom-0"
            style={{
              height: 14,
              pointerEvents: 'none',
              background: `linear-gradient(to bottom, transparent, ${fadeColor})`,
            }}
          />
        )}
      </div>
      {overflows && (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((prev) => !prev)}
          className="flex items-center justify-center gap-1 w-full text-[11px] font-medium transition-colors hover:bg-[color:var(--bg-hover)]"
          style={{ height: 24, color: 'var(--text-3)', borderTop: '1px solid var(--border-1)' }}
        >
          {expanded ? t('clamp.collapse', 'Collapse') : t('clamp.expand', 'Show more')}
          {expanded ? <ChevronUp size={12} aria-hidden /> : <ChevronDown size={12} aria-hidden />}
        </button>
      )}
    </div>
  );
}

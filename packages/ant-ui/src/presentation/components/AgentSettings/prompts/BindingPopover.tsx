/**
 * Binding popover — the SINGLE surface for reading and editing one prompt
 * file's intent bindings. Opens from a row's intent badge (that intent's row
 * highlighted) or its hover "+" button. Portal-rendered with the KebabMenu
 * position/dismiss core so list overflow containers never clip it.
 *
 * Mutations flow through the shell's bind/unbind handlers into the intents
 * draft (ChangedBar saves them) — nothing here writes to disk.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Target, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AuroraSelect } from '@/presentation/components/ConfigEditor/aurora';

const POPOVER_WIDTH = 280;

export interface BindingPopoverProps {
  anchor: HTMLElement;
  /** Bound intent ids of the file (draft state — pending binds included). */
  boundIntents: string[];
  /** Intent ids the file can still be bound to. */
  bindable: string[];
  readonly: boolean;
  /** Badge-opened: pre-highlight that intent's row. */
  highlightIntent?: string;
  onBind: (intentId: string) => void;
  onUnbind: (intentId: string) => void;
  onClose: () => void;
}

export function BindingPopover({
  anchor,
  boundIntents,
  bindable,
  readonly,
  highlightIntent,
  onBind,
  onUnbind,
  onClose,
}: BindingPopoverProps) {
  const { t } = useTranslation('agents');
  const popoverRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const updatePosition = useCallback(() => {
    const rect = anchor.getBoundingClientRect();
    const GAP = 6;
    let left = rect.left;
    if (left + POPOVER_WIDTH > window.innerWidth - 8) left = window.innerWidth - POPOVER_WIDTH - 8;
    if (left < 8) left = 8;
    let top = rect.bottom + GAP;
    const estimatedHeight = 90 + boundIntents.length * 52;
    if (top + estimatedHeight > window.innerHeight - 8) top = Math.max(8, rect.top - estimatedHeight - GAP);
    setPos({ top, left });
  }, [anchor, boundIntents.length]);

  useEffect(() => {
    updatePosition();
  }, [updatePosition]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        popoverRef.current && !popoverRef.current.contains(e.target as Node) &&
        !anchor.contains(e.target as Node)
      ) {
        onClose();
      }
    };
    const handleKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    const handleScroll = (e: Event) => {
      if (e.target instanceof Node && (e.target as Node).contains(anchor)) onClose();
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKey);
    window.addEventListener('resize', onClose);
    const rafId = requestAnimationFrame(() => document.addEventListener('scroll', handleScroll, true));
    return () => {
      cancelAnimationFrame(rafId);
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKey);
      document.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', onClose);
    };
  }, [anchor, onClose]);

  if (!pos) return null;

  return createPortal(
    <div
      ref={popoverRef}
      className="fixed z-[9999] rounded-md border border-[color:var(--border-1)] bg-[color:var(--bg-surface)] shadow-lg p-2 animate-in fade-in-0 zoom-in-95 duration-100 flex flex-col gap-1.5"
      style={{ top: pos.top, left: pos.left, width: POPOVER_WIDTH }}
    >
      {boundIntents.length === 0 && (
        <p className="m-0 px-1 py-0.5 text-xs" style={{ color: 'var(--text-4)', lineHeight: 1.5 }}>
          {t('prompts.notBound', 'Not bound to any intent — listed in the on-demand TOC only.')}
        </p>
      )}
      {boundIntents.map((intentId) => (
        <div
          key={intentId}
          className="flex items-start gap-2 px-1.5 py-1 rounded"
          style={{
            background: highlightIntent === intentId ? 'var(--select-fill-violet)' : 'transparent',
          }}
        >
          <Target size={12} className="shrink-0" style={{ marginTop: 2, color: 'var(--text-3)' }} />
          <span className="flex-1 min-w-0 text-xs" style={{ color: 'var(--text-2)', lineHeight: 1.5 }}>
            {t('prompts.bindingExplain', 'Injected whenever the {{intent}} intent fires.', { intent: intentId })}
          </span>
          {!readonly && (
            <button
              type="button"
              className="shrink-0 inline-flex items-center gap-1 text-[10px] px-1 py-0.5 rounded hover:bg-[color:var(--bg-hover)]"
              style={{ color: 'var(--status-error-fg, var(--text-3))' }}
              onClick={() => onUnbind(intentId)}
            >
              <X className="w-3 h-3" /> {t('prompts.unbind', 'Unbind')}
            </button>
          )}
        </div>
      ))}
      {!readonly && bindable.length > 0 && (
        <AuroraSelect
          value=""
          onChange={(v) => v && onBind(v)}
          placeholder={t('prompts.bindToIntent', 'Bind to intent…')}
          options={bindable.map((iid) => ({ value: iid, label: iid }))}
        />
      )}
    </div>,
    document.body,
  );
}

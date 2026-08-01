'use client';

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Cloud, X } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useRef, type ReactNode } from 'react';

interface ComingSoonModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  body: string;
  closeLabel: string;
  /** Optional secondary action rendered beside the close button. */
  action?: { href: string; label: string };
  /** Accessible label for the backdrop dismiss target. */
  dismissLabel: string;
}

/**
 * Centered dialog for surfaces that are announced but not yet reachable.
 *
 * Presentational only — the caller owns `open`. Mount it once (see
 * `CloudGateProvider`) rather than per call site, so two gated CTAs on the
 * same page cannot stack two overlays.
 */
export function ComingSoonModal({
  open,
  onClose,
  title,
  body,
  closeLabel,
  action,
  dismissLabel,
}: ComingSoonModalProps) {
  const reduce = useReducedMotion();
  const closeRef = useRef<HTMLButtonElement>(null);

  const onKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    },
    [onClose],
  );

  useEffect(() => {
    if (!open) return;
    document.addEventListener('keydown', onKeyDown);
    // Restore rather than hard-clear: the site sets no other overflow lock, but
    // clearing unconditionally would fight one if a future surface adds it.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onKeyDown]);

  const panel: ReactNode = (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="coming-soon-title"
      aria-describedby="coming-soon-body"
      onClick={(e) => e.stopPropagation()}
      className="relative w-full max-w-md mx-4"
      style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-2)',
        borderRadius: 'var(--r-2xl)',
        boxShadow: 'var(--shadow-lg)',
        backdropFilter: 'blur(12px)',
        padding: 30,
      }}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label={closeLabel}
        className="absolute top-4 right-4 p-1.5 rounded-lg transition-colors hover:bg-[var(--bg-hover)]"
        style={{ color: 'var(--text-4)' }}
      >
        <X className="w-4 h-4" />
      </button>

      <div
        className="inline-flex items-center justify-center rounded-xl mb-4"
        style={{
          width: 44,
          height: 44,
          background: 'var(--gradient-aurora)',
          color: 'var(--text-on-brand)',
        }}
      >
        <Cloud className="w-5 h-5" />
      </div>

      <h2
        id="coming-soon-title"
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: 20,
          fontWeight: 700,
          letterSpacing: '-0.01em',
          color: 'var(--text-1)',
          marginBottom: 10,
        }}
      >
        {title}
      </h2>

      <p
        id="coming-soon-body"
        style={{ fontSize: 14, color: 'var(--text-3)', lineHeight: 'var(--lh-relaxed)' }}
      >
        {body}
      </p>

      <div className="flex items-center gap-3 mt-6">
        {action && (
          <Link
            href={action.href}
            onClick={onClose}
            className="inline-flex items-center justify-center transition-colors"
            style={{
              height: 40,
              padding: '0 18px',
              borderRadius: 'var(--r-md)',
              fontSize: 14,
              fontWeight: 600,
              background: 'var(--gradient-aurora)',
              color: 'var(--text-on-brand)',
              textDecoration: 'none',
            }}
          >
            {action.label}
          </Link>
        )}
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          className="inline-flex items-center justify-center transition-colors"
          style={{
            height: 40,
            padding: '0 18px',
            borderRadius: 'var(--r-md)',
            fontSize: 14,
            fontWeight: 600,
            background: 'transparent',
            border: '1px solid var(--border-2)',
            color: 'var(--text-2)',
            cursor: 'pointer',
          }}
        >
          {closeLabel}
        </button>
      </div>
    </div>
  );

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[100] flex items-center justify-center"
          style={{ background: 'rgba(6, 4, 14, 0.6)', backdropFilter: 'blur(4px)' }}
          onClick={onClose}
          aria-label={dismissLabel}
          initial={reduce ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={reduce ? undefined : { opacity: 0 }}
          transition={{ duration: 0.16 }}
        >
          {reduce ? (
            panel
          ) : (
            <motion.div
              className="w-full flex items-center justify-center"
              initial={{ opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.99 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            >
              {panel}
            </motion.div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

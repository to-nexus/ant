
/**
 * Toast Component (Aurora)
 *
 * Non-blocking notification that auto-dismisses. Ported from
 * visual/ui/handoff/project/d1-toasts.jsx. Aurora glass surface with:
 *  - 4px left gradient ribbon (tone-driven)
 *  - 32px gradient icon orb (squared, smaller than the modal IconOrb)
 *  - bottom progress bar (tone gradient with gradient-shift loop)
 *  - spring slide-in / slide-out animation
 *  - stacked in the top-right with `pointer-events: none` wrapper
 *
 * Unlike AlertModal (blocking, singleton), Toast:
 * - Can show multiple notifications simultaneously (stacked)
 * - Auto-dismisses after a configurable duration
 * - Does not block user interaction
 * - Renders via Portal at document.body level
 */

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../aurora/Icon';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface ToastItem {
  id: string;
  type: ToastType;
  message: string;
  duration: number;
}

interface ToastTone {
  halo: string;
  icon: string;
  accent: string;
}

const TOAST_TONES: Record<ToastType, ToastTone> = {
  success: {
    halo: 'linear-gradient(135deg, var(--emerald-500), var(--teal-500))',
    icon: 'check-circle',
    accent: 'var(--emerald-500)',
  },
  error: {
    halo: 'linear-gradient(135deg, var(--red-500), var(--pink-500))',
    icon: 'shield-alert',
    accent: 'var(--red-500)',
  },
  info: {
    halo: 'var(--gradient-violet-pink)',
    icon: 'compass',
    accent: 'var(--violet-500)',
  },
  warning: {
    halo: 'linear-gradient(135deg, var(--orange-400), var(--pink-400))',
    icon: 'alert-triangle',
    accent: 'var(--orange-500)',
  },
};

/* ------------------------------------------------------------------
 * Keyframes injection — module-scope, idempotent. The toast surface
 * needs `toast-slide-in` + `toast-progress` keyframes that are not
 * part of aurora-tokens.css (the design tokens file is owned by T3
 * and cannot be edited from this task).
 * ------------------------------------------------------------------ */
const TOAST_KEYFRAMES_ID = '__aurora_toast_keyframes';

function ensureToastKeyframes(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(TOAST_KEYFRAMES_ID)) return;
  const style = document.createElement('style');
  style.id = TOAST_KEYFRAMES_ID;
  style.textContent = `
    @keyframes toast-slide-in {
      from { opacity: 0; transform: translateX(40px) scale(0.95); }
      to   { opacity: 1; transform: translateX(0)    scale(1); }
    }
    @keyframes toast-progress {
      from { width: 100%; }
      to   { width: 0%; }
    }
  `;
  document.head.appendChild(style);
}

if (typeof document !== 'undefined') {
  ensureToastKeyframes();
}

interface ToastItemProps {
  toast: ToastItem;
  onRemove: (id: string) => void;
}

function ToastItemComponent({ toast, onRemove }: ToastItemProps) {
  const [isExiting, setIsExiting] = useState(false);
  const tone = TOAST_TONES[toast.type];

  useEffect(() => {
    ensureToastKeyframes();
  }, []);

  useEffect(() => {
    const exitTimer = setTimeout(() => {
      setIsExiting(true);
    }, Math.max(0, toast.duration - 280));

    const removeTimer = setTimeout(() => {
      onRemove(toast.id);
    }, toast.duration);

    return () => {
      clearTimeout(exitTimer);
      clearTimeout(removeTimer);
    };
  }, [toast.id, toast.duration, onRemove]);

  const handleClose = () => {
    setIsExiting(true);
    setTimeout(() => onRemove(toast.id), 240);
  };

  return (
    <div
      role="alert"
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
        minWidth: 320,
        maxWidth: 420,
        padding: '14px',
        borderRadius: 16,
        background: 'oklch(from var(--bg-surface) l c h / 0.92)',
        backdropFilter: 'blur(20px) saturate(180%)',
        WebkitBackdropFilter: 'blur(20px) saturate(180%)',
        border: '1px solid var(--border-1)',
        boxShadow:
          'var(--shadow-lg), inset 0 1px 0 oklch(100% 0 0 / 0.4)',
        overflow: 'hidden',
        transform: isExiting
          ? 'translateX(120%) scale(0.95)'
          : 'translateX(0) scale(1)',
        opacity: isExiting ? 0 : 1,
        transition:
          'transform 280ms var(--ease-spring), opacity 240ms var(--ease-smooth)',
        animation: isExiting
          ? 'none'
          : 'toast-slide-in 380ms var(--ease-spring) both',
      }}
    >
      {/* Left accent ribbon */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: 0,
          width: 4,
          background: tone.halo,
          backgroundSize: '200% 200%',
          animation: 'gradient-shift 5s ease-in-out infinite',
        }}
      />

      {/* Icon orb (squared, smaller variant) */}
      <div
        style={{
          position: 'relative',
          flexShrink: 0,
          width: 32,
          height: 32,
          borderRadius: 10,
          background: tone.halo,
          backgroundSize: '200% 200%',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'white',
          boxShadow: `0 4px 14px ${tone.accent}40`,
        }}
      >
        <Icon name={tone.icon} size={16} stroke={2} />
      </div>

      {/* Message */}
      <p
        style={{
          flex: 1,
          minWidth: 0,
          margin: 0,
          paddingTop: 4,
          fontSize: 13,
          color: 'var(--text-2)',
          lineHeight: 1.5,
        }}
      >
        {toast.message}
      </p>

      {/* Close */}
      <button
        onClick={handleClose}
        aria-label="Close"
        style={{
          flexShrink: 0,
          width: 24,
          height: 24,
          borderRadius: 7,
          background: 'transparent',
          border: 'none',
          color: 'var(--text-4)',
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'all var(--dur-fast) var(--ease-smooth)',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'var(--bg-hover)';
          e.currentTarget.style.color = 'var(--text-1)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent';
          e.currentTarget.style.color = 'var(--text-4)';
        }}
      >
        <Icon name="x" size={13} />
      </button>

      {/* Bottom progress bar */}
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: 3,
          background: 'oklch(from var(--bg-surface-2) l c h / 0.6)',
        }}
      >
        <div
          style={{
            height: '100%',
            background: tone.halo,
            backgroundSize: '200% 200%',
            animation: `toast-progress ${toast.duration}ms linear forwards, gradient-shift 4s ease-in-out infinite`,
          }}
        />
      </div>
    </div>
  );
}

interface ToastContainerProps {
  toasts: ToastItem[];
  onRemove: (id: string) => void;
}

export function ToastContainer({ toasts, onRemove }: ToastContainerProps) {
  if (toasts.length === 0) return null;

  return createPortal(
    <div
      aria-live="polite"
      style={{
        position: 'fixed',
        top: 20,
        right: 20,
        zIndex: 'var(--z-toast)' as unknown as number,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        pointerEvents: 'none',
      }}
    >
      {toasts.map((toast) => (
        <div key={toast.id} style={{ pointerEvents: 'auto' }}>
          <ToastItemComponent toast={toast} onRemove={onRemove} />
        </div>
      ))}
    </div>,
    document.body,
  );
}

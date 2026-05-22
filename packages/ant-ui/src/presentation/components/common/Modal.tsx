
/**
 * Modal Component (Aurora)
 *
 * Aurora-themed glass shell with halo, shimmer sweep, top accent ribbon, and
 * spring-in entrance. Ported from visual/ui/handoff/project/d1-modals.jsx
 * (`AuroraModal`). Preserves the legacy public surface (`isOpen`, `onClose`,
 * `title`, `children`, `size`, `onBackdropClick`) and adds optional Aurora
 * props (`accent`, `eyebrow`, `footer`, `hideHeader`, `scrollable`) so older
 * call sites keep working without modification.
 */

import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '../aurora/Icon';

let modalStack: number[] = [];
let nextModalId = 0;

export type ModalAccent =
  | 'aurora'
  | 'violet'
  | 'pink'
  | 'orange'
  | 'emerald'
  | 'red';

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl';

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  size?: ModalSize;
  /** If provided, called instead of onClose when backdrop is clicked. */
  onBackdropClick?: () => void;
  /** Aurora accent tone — drives top ribbon + eyebrow color. */
  accent?: ModalAccent;
  /** Small uppercase pill above the title. */
  eyebrow?: string;
  /** Optional footer slot rendered in a divided bar. */
  footer?: React.ReactNode;
  /** Suppress the default header (caller supplies its own). */
  hideHeader?: boolean;
  /** Make the body scrollable when content exceeds height. */
  scrollable?: boolean;
}

interface AccentSpec {
  halo: string;
  text: string;
}

const ACCENT: Record<ModalAccent, AccentSpec> = {
  aurora: { halo: 'var(--gradient-aurora)', text: 'var(--violet-600)' },
  violet: { halo: 'var(--gradient-violet-pink)', text: 'var(--violet-600)' },
  pink: { halo: 'var(--gradient-pink-orange)', text: 'var(--pink-600)' },
  orange: {
    halo: 'linear-gradient(135deg, var(--orange-400), var(--pink-400))',
    text: 'var(--orange-600)',
  },
  emerald: {
    halo: 'linear-gradient(135deg, var(--emerald-500), var(--teal-500))',
    text: 'oklch(48% 0.16 155)',
  },
  red: {
    halo: 'linear-gradient(135deg, var(--red-500), var(--pink-500))',
    text: 'var(--red-500)',
  },
};

const SIZE_PX: Record<ModalSize, number> = {
  sm: 420,
  md: 520,
  lg: 680,
  xl: 880,
};

export function Modal({
  isOpen,
  onClose,
  title,
  children,
  size = 'md',
  onBackdropClick,
  accent = 'aurora',
  eyebrow,
  footer,
  hideHeader = false,
  scrollable = false,
}: ModalProps) {
  const { t } = useTranslation('common');
  const modalRef = useRef<HTMLDivElement>(null);
  const modalId = useRef(nextModalId++).current;

  // Track modal in stack (topmost = last)
  useEffect(() => {
    if (isOpen) {
      modalStack.push(modalId);
      return () => {
        modalStack = modalStack.filter((id) => id !== modalId);
      };
    }
  }, [isOpen, modalId]);

  // Close on ESC key — only if this is the topmost modal
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (
        e.key === 'Escape' &&
        isOpen &&
        modalStack[modalStack.length - 1] === modalId
      ) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose, modalId]);

  // Track where mousedown started to prevent text-drag from triggering backdrop close
  const mouseDownTarget = useRef<EventTarget | null>(null);
  const handleMouseDown = (e: React.MouseEvent) => {
    mouseDownTarget.current = e.target;
  };
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget && mouseDownTarget.current === e.currentTarget) {
      (onBackdropClick ?? onClose)();
    }
    mouseDownTarget.current = null;
  };

  if (!isOpen) return null;

  const a = ACCENT[accent];

  return (
    <div
      onMouseDown={handleMouseDown}
      onClick={handleBackdropClick}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 'var(--z-modal)' as unknown as number,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'oklch(0% 0 0 / 0.5)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        padding: 16,
        animation: 'qs-fade-in-up 280ms var(--ease-smooth) both',
      }}
    >
      <div
        ref={modalRef}
        style={{
          position: 'relative',
          width: `min(${SIZE_PX[size]}px, calc(100vw - 32px))`,
          maxHeight: 'calc(100vh - 48px)',
          borderRadius: 28,
          background: 'oklch(from var(--bg-surface) l c h / 0.96)',
          backdropFilter: 'blur(24px) saturate(180%)',
          WebkitBackdropFilter: 'blur(24px) saturate(180%)',
          border: '1px solid var(--border-1)',
          boxShadow:
            'var(--shadow-xl), inset 0 1px 0 oklch(100% 0 0 / 0.5)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          animation: 'spring-in var(--dur-slow) var(--ease-spring) both',
        }}
      >
        {/* Halo glow */}
        <div
          aria-hidden
          style={{
            position: 'absolute',
            inset: -12,
            borderRadius: 40,
            background: 'var(--gradient-aurora)',
            opacity: 0.55,
            filter: 'blur(36px)',
            zIndex: -1,
            pointerEvents: 'none',
          }}
        />

        {/* Shimmer sweep */}
        <div
          aria-hidden
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: 'inherit',
            overflow: 'hidden',
            pointerEvents: 'none',
            mixBlendMode: 'overlay',
            opacity: 0.5,
          }}
        >
          <div
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              width: '40%',
              background:
                'linear-gradient(90deg, transparent 0%, oklch(100% 0 0 / 0.35) 50%, transparent 100%)',
              animation:
                'task-shimmer-sweep 1400ms var(--ease-smooth) 1 forwards',
            }}
          />
        </div>

        {/* Top accent ribbon */}
        <div
          aria-hidden
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: 4,
            background: a.halo,
            backgroundSize: '200% 200%',
            animation: 'gradient-shift 6s ease-in-out infinite',
            zIndex: 2,
          }}
        />

        {!hideHeader && (
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              gap: 16,
              padding: '20px 24px 14px',
              borderBottom: '1px solid var(--border-1)',
              position: 'relative',
              zIndex: 1,
            }}
          >
            <div style={{ minWidth: 0 }}>
              {eyebrow && (
                <div
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: 1.4,
                    textTransform: 'uppercase',
                    color: a.text,
                    marginBottom: 6,
                  }}
                >
                  <span
                    style={{
                      width: 5,
                      height: 5,
                      borderRadius: '50%',
                      background: a.halo,
                    }}
                  />
                  {eyebrow}
                </div>
              )}
              <h2
                className="text-display"
                style={{
                  margin: 0,
                  fontSize: 19,
                  fontWeight: 700,
                  color: 'var(--text-1)',
                  letterSpacing: '-0.01em',
                  lineHeight: 1.25,
                }}
              >
                {title}
              </h2>
            </div>
            <button
              onClick={onClose}
              aria-label={t('modal.closeModal')}
              style={{
                flexShrink: 0,
                width: 32,
                height: 32,
                borderRadius: 10,
                border: '1px solid var(--border-1)',
                background: 'oklch(from var(--bg-surface-2) l c h / 0.6)',
                color: 'var(--text-3)',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'transform var(--dur-fast) var(--ease-smooth), opacity var(--dur-fast) var(--ease-smooth), box-shadow var(--dur-fast) var(--ease-smooth)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--bg-hover)';
                e.currentTarget.style.color = 'var(--text-1)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background =
                  'oklch(from var(--bg-surface-2) l c h / 0.6)';
                e.currentTarget.style.color = 'var(--text-3)';
              }}
            >
              <Icon name="x" size={15} />
            </button>
          </div>
        )}

        <div
          style={{
            padding: '18px 24px 20px',
            overflowY: scrollable ? 'auto' : 'visible',
            flex: 1,
            minHeight: 0,
            position: 'relative',
            zIndex: 1,
          }}
        >
          {children}
        </div>

        {footer && (
          <div
            style={{
              padding: '14px 24px 18px',
              borderTop: '1px solid var(--border-1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-end',
              gap: 10,
              background: 'oklch(from var(--bg-surface-2) l c h / 0.4)',
              position: 'relative',
              zIndex: 1,
            }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

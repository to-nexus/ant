
/**
 * AlertModal — typed modal for alerts and confirmations (Aurora).
 *
 * `onConfirm` is synchronous (`() => void`). Long-running work triggered
 * by a confirmation must live outside the modal — use
 * `ConfirmAndDispatch` from `common/operation` instead.
 *
 * Types:
 * - info:    Informational message (violet)
 * - success: Positive feedback (emerald)
 * - warning: Warning message (orange — danger CTA)
 * - error:   Error message (red — danger CTA)
 *
 * Button Modes:
 * - confirm-only:   Single OK button
 * - confirm-cancel: OK and Cancel buttons
 */

import { useRef, useEffect } from 'react';
import { Modal, type ModalAccent } from './Modal';
import { IconOrb } from '../aurora/IconOrb';

export type AlertType = 'info' | 'success' | 'warning' | 'error';
export type ButtonMode = 'confirm-only' | 'confirm-cancel';

export interface AlertModalProps {
  isOpen: boolean;
  onClose: () => void;
  type?: AlertType;
  title: string;
  message: string | React.ReactNode;
  showIcon?: boolean;
  buttonMode?: ButtonMode;
  confirmText?: string;
  cancelText?: string;
  /**
   * Confirm handler. The modal closes as soon as this returns — the
   * handler is fire-and-forget; async work is the caller's responsibility
   * (see `ConfirmAndDispatch`). Passing an async function works but the
   * promise is not awaited.
   */
  onConfirm?: () => void | Promise<void>;
  onCancel?: () => void;
}

interface ToneSpec {
  accent: ModalAccent;
  danger: boolean;
}

const TYPE_TONES: Record<AlertType, ToneSpec> = {
  info: { accent: 'violet', danger: false },
  success: { accent: 'emerald', danger: false },
  warning: { accent: 'orange', danger: true },
  error: { accent: 'red', danger: true },
};

function ghostButtonStyle(): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 38,
    padding: '0 16px',
    background: 'oklch(from var(--bg-surface) l c h / 0.7)',
    color: 'var(--text-2)',
    border: '1px solid var(--border-2)',
    borderRadius: 12,
    fontSize: 13,
    fontWeight: 600,
    letterSpacing: '-0.01em',
    fontFamily: 'inherit',
    cursor: 'pointer',
  };
}

function auroraButtonStyle(): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 38,
    padding: '0 18px',
    background: 'var(--gradient-aurora)',
    backgroundSize: '200% 200%',
    color: 'var(--text-on-brand)',
    border: 'none',
    borderRadius: 12,
    fontSize: 13,
    fontWeight: 700,
    letterSpacing: '-0.01em',
    fontFamily: 'inherit',
    boxShadow: 'var(--shadow-glow-aurora)',
    cursor: 'pointer',
    animation: 'gradient-shift 5s ease-in-out infinite',
    transition: 'transform var(--dur-base) var(--ease-spring)',
  };
}

function dangerButtonStyle(type: 'warning' | 'error'): React.CSSProperties {
  const colors =
    type === 'warning'
      ? {
          bg: 'linear-gradient(135deg, var(--orange-500), var(--orange-600))',
          glow: 'oklch(70% 0.18 50 / 0.45)',
        }
      : {
          bg: 'linear-gradient(135deg, var(--red-500), var(--pink-500))',
          glow: 'oklch(65% 0.22 25 / 0.45)',
        };
  return {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 38,
    padding: '0 18px',
    background: colors.bg,
    color: 'white',
    border: 'none',
    borderRadius: 12,
    fontSize: 13,
    fontWeight: 700,
    letterSpacing: '-0.01em',
    fontFamily: 'inherit',
    boxShadow: `0 6px 20px ${colors.glow}, 0 1px 2px rgba(0,0,0,0.1)`,
    cursor: 'pointer',
  };
}

export function AlertModal({
  isOpen,
  onClose,
  type = 'info',
  title,
  message,
  showIcon = true,
  buttonMode = 'confirm-only',
  confirmText = 'OK',
  cancelText = 'Cancel',
  onConfirm,
  onCancel,
}: AlertModalProps) {
  const tone = TYPE_TONES[type];
  const confirmButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (isOpen && confirmButtonRef.current) {
      const timer = setTimeout(() => {
        confirmButtonRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  const handleConfirm = () => {
    try {
      onConfirm?.();
    } catch (err) {
      // Fire-and-forget semantics — surface the error on the console but
      // do not block modal close.
      console.error('[AlertModal] onConfirm threw:', err);
    }
    onClose();
  };

  const handleCancel = () => {
    if (onCancel) onCancel();
    onClose();
  };

  const confirmStyle = tone.danger
    ? dangerButtonStyle(type as 'warning' | 'error')
    : auroraButtonStyle();

  const footer = (
    <>
      {buttonMode === 'confirm-cancel' && (
        <button onClick={handleCancel} style={ghostButtonStyle()}>
          {cancelText}
        </button>
      )}
      <button ref={confirmButtonRef} onClick={handleConfirm} style={confirmStyle}>
        {confirmText}
      </button>
    </>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleCancel}
      title={title}
      size="sm"
      accent={tone.accent}
      eyebrow={type.toUpperCase()}
      footer={footer}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
        {showIcon && <IconOrb type={type} size={48} />}
        <div
          style={{
            flex: 1,
            paddingTop: 4,
            color: 'var(--text-2)',
            fontSize: 14,
            lineHeight: 1.55,
          }}
        >
          {typeof message === 'string' ? (
            <p style={{ margin: 0 }}>{message}</p>
          ) : (
            message
          )}
        </div>
      </div>
    </Modal>
  );
}

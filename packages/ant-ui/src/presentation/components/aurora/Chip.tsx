
import * as React from 'react';
import { Icon } from './Icon';

/**
 * Aurora Chip — pill button. Active state inlines var(--gradient-violet-pink)
 * background + var(--shadow-glow-aurora) per ui.jsx.
 */

export type ChipTone =
  | 'neutral'
  | 'brand'
  | 'pink'
  | 'orange'
  | 'success'
  | 'warning'
  | 'error'
  | 'info';

export interface ChipProps {
  tone?: ChipTone;
  active?: boolean;
  icon?: string;
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
  onClose?: () => void;
  children?: React.ReactNode;
  style?: React.CSSProperties;
  className?: string;
  disabled?: boolean;
  title?: string;
  'aria-label'?: string;
}

export function Chip({
  // `tone` is accepted by the public API for future per-tone styling but the
  // ui.jsx baseline only distinguishes active vs inactive — keep the prop
  // surface and ignore for now to remain spec-faithful.
  tone: _tone = 'neutral',
  active = false,
  icon,
  onClick,
  onClose,
  children,
  style,
  className,
  disabled,
  title,
  'aria-label': ariaLabel,
}: ChipProps) {
  // Touch the prop to satisfy `noUnusedParameters` while preserving the
  // public surface for future tone-aware styling.
  void _tone;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={className}
      title={title}
      aria-label={ariaLabel}
      aria-pressed={active || undefined}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        height: 36,
        padding: '0 16px',
        background: active ? 'var(--gradient-violet-pink)' : 'var(--bg-surface)',
        color: active ? 'white' : 'var(--text-2)',
        border: active ? 'none' : '1px solid var(--border-2)',
        borderRadius: 'var(--r-pill)',
        fontSize: 13,
        fontWeight: 600,
        fontFamily: 'inherit',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition: 'all var(--dur-base) var(--ease-spring)',
        boxShadow: active ? 'var(--shadow-glow-aurora)' : 'var(--shadow-xs)',
        ...style,
      }}
      onMouseEnter={(e) => {
        if (!active && !disabled) {
          e.currentTarget.style.transform = 'translateY(-2px)';
          e.currentTarget.style.boxShadow = 'var(--shadow-md)';
        }
      }}
      onMouseLeave={(e) => {
        if (!active && !disabled) {
          e.currentTarget.style.transform = 'translateY(0)';
          e.currentTarget.style.boxShadow = 'var(--shadow-xs)';
        }
      }}
    >
      {icon && <Icon name={icon} size={14} />}
      {children}
      {onClose && (
        <span
          role="button"
          tabIndex={0}
          aria-label="Remove"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              e.stopPropagation();
              onClose();
            }
          }}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginLeft: 4,
            cursor: 'pointer',
            opacity: 0.7,
          }}
        >
          <Icon name="x" size={12} />
        </span>
      )}
    </button>
  );
}

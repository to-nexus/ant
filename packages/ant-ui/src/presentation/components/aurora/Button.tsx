
import * as React from 'react';
import { Icon } from './Icon';

/**
 * Aurora Button — ported from visual/ui/handoff/project/ui.jsx + cookbook §4.5 §5.1.
 *
 * variant='primary' inlines the signature aurora gradient + glow + gradient-shift
 * animation as specified in §4.5 §5.1 verbatim (gradient, backgroundSize, color,
 * boxShadow, animation).
 *
 * Note: legacy `asChild` (Radix Slot) is intentionally NOT supported. Call sites
 * that wrapped an anchor via asChild must render the link element directly.
 */

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline';
export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

export interface ButtonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  iconLeft?: string;
  iconRight?: string;
  fullWidth?: boolean;
  glow?: boolean;
  children?: React.ReactNode;
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
  onMouseDown?: React.MouseEventHandler<HTMLButtonElement>;
  onMouseUp?: React.MouseEventHandler<HTMLButtonElement>;
  onMouseLeave?: React.MouseEventHandler<HTMLButtonElement>;
  onMouseEnter?: React.MouseEventHandler<HTMLButtonElement>;
  disabled?: boolean;
  style?: React.CSSProperties;
  className?: string;
  type?: 'button' | 'submit' | 'reset';
  title?: string;
  'aria-label'?: string;
}

const SIZE_TABLE: Record<ButtonSize, React.CSSProperties> = {
  xs: { height: 28, padding: '0 12px', fontSize: 12, borderRadius: 8 },
  sm: { height: 34, padding: '0 14px', fontSize: 13, borderRadius: 10 },
  md: { height: 40, padding: '0 18px', fontSize: 14, borderRadius: 12 },
  lg: { height: 48, padding: '0 24px', fontSize: 15, borderRadius: 14 },
  xl: { height: 56, padding: '0 28px', fontSize: 16, borderRadius: 16 },
};

const ICON_SIZE_TABLE: Record<ButtonSize, number> = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 16,
  xl: 18,
};

function variantStyles(variant: ButtonVariant, glow: boolean): React.CSSProperties {
  switch (variant) {
    case 'primary':
      // §4.5 §5.1 verbatim: gradient + 200% size + glow + gradient-shift animation
      return {
        background: 'var(--gradient-aurora)',
        backgroundSize: '200% 200%',
        color: 'var(--text-on-brand)',
        boxShadow: glow ? 'var(--shadow-glow-aurora)' : 'var(--shadow-glow-aurora)',
        animation: 'gradient-shift 5s ease-in-out infinite',
      };
    case 'secondary':
      return {
        background: 'var(--bg-surface)',
        color: 'var(--text-1)',
        border: '1px solid var(--border-2)',
        boxShadow: 'var(--shadow-xs)',
      };
    case 'ghost':
      return {
        background: 'transparent',
        color: 'var(--text-2)',
      };
    case 'danger':
      return {
        background: 'var(--red-500)',
        color: 'white',
        boxShadow: 'var(--shadow-xs)',
      };
    case 'outline':
      return {
        background: 'transparent',
        color: 'var(--violet-600)',
        border: '1.5px solid var(--violet-300)',
      };
    default:
      return {};
  }
}

const BASE_STYLE: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  fontFamily: 'var(--font-display)',
  fontWeight: 600,
  letterSpacing: '-0.01em',
  border: 'none',
  cursor: 'pointer',
  position: 'relative',
  overflow: 'hidden',
  transition:
    'transform var(--dur-base) var(--ease-spring), box-shadow var(--dur-base) var(--ease-smooth), background var(--dur-fast) var(--ease-smooth)',
  whiteSpace: 'nowrap',
  userSelect: 'none',
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(props, ref) {
    const {
      variant = 'primary',
      size = 'md',
      loading = false,
      iconLeft,
      iconRight,
      fullWidth,
      glow = false,
      children,
      onClick,
      onMouseDown,
      onMouseUp,
      onMouseLeave,
      onMouseEnter,
      disabled,
      style,
      className,
      type = 'button',
      title,
      'aria-label': ariaLabel,
    } = props;

    const [pressed, setPressed] = React.useState(false);
    const isDisabled = disabled || loading;
    const iconSize = ICON_SIZE_TABLE[size];

    const composedStyle: React.CSSProperties = {
      ...BASE_STYLE,
      ...SIZE_TABLE[size],
      ...variantStyles(variant, glow),
      ...(fullWidth ? { width: '100%' } : null),
      opacity: isDisabled ? 0.5 : 1,
      transform: pressed && !isDisabled ? 'scale(0.97)' : 'scale(1)',
      cursor: isDisabled ? 'not-allowed' : 'pointer',
      ...style,
    };

    const handleMouseDown: React.MouseEventHandler<HTMLButtonElement> = (e) => {
      if (!isDisabled) setPressed(true);
      onMouseDown?.(e);
    };
    const handleMouseUp: React.MouseEventHandler<HTMLButtonElement> = (e) => {
      setPressed(false);
      onMouseUp?.(e);
    };
    const handleMouseLeave: React.MouseEventHandler<HTMLButtonElement> = (e) => {
      setPressed(false);
      onMouseLeave?.(e);
    };

    const cls = ['gradient-flow', className].filter(Boolean).join(' ');

    return (
      <button
        ref={ref}
        type={type}
        onClick={onClick}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onMouseEnter={onMouseEnter}
        disabled={isDisabled}
        className={cls}
        style={composedStyle}
        title={title}
        aria-label={ariaLabel}
        aria-busy={loading || undefined}
      >
        {loading ? (
          <span
            aria-hidden
            style={{
              width: iconSize,
              height: iconSize,
              borderRadius: '50%',
              border: '2px solid currentColor',
              borderTopColor: 'transparent',
              animation: 'spin 0.7s linear infinite',
              display: 'inline-block',
            }}
          />
        ) : (
          iconLeft && <Icon name={iconLeft} size={iconSize} />
        )}
        {children !== undefined && children !== null && children !== false && (
          <span style={{ display: 'inline-flex', alignItems: 'center' }}>{children}</span>
        )}
        {!loading && iconRight && <Icon name={iconRight} size={iconSize} />}
      </button>
    );
  },
);

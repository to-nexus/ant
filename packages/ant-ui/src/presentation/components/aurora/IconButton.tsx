
import * as React from 'react';
import { Icon } from './Icon';

/**
 * Aurora IconButton — square icon-only button.
 * `aria-label` is REQUIRED per spec §4.2.
 */
export interface IconButtonProps {
  icon: React.ReactNode | string;
  tone?: 'neutral' | 'brand' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  'aria-label': string;
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
  active?: boolean;
  title?: string;
  style?: React.CSSProperties;
  className?: string;
  disabled?: boolean;
}

const DIM_TABLE = { sm: 30, md: 36, lg: 44 } as const;
const ICON_TABLE = { sm: 14, md: 16, lg: 20 } as const;

function toneColors(tone: NonNullable<IconButtonProps['tone']>, active: boolean) {
  if (active) {
    switch (tone) {
      case 'brand':
        return { bg: 'var(--bg-active)', color: 'var(--violet-600)' };
      case 'danger':
        return { bg: 'var(--bg-active)', color: 'var(--red-500)' };
      case 'neutral':
      default:
        return { bg: 'var(--bg-active)', color: 'var(--violet-600)' };
    }
  }
  switch (tone) {
    case 'brand':
      return { bg: 'transparent', color: 'var(--violet-600)' };
    case 'danger':
      return { bg: 'transparent', color: 'var(--red-500)' };
    case 'neutral':
    default:
      return { bg: 'transparent', color: 'var(--text-2)' };
  }
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton(props, ref) {
    const {
      icon,
      tone = 'neutral',
      size = 'md',
      onClick,
      active = false,
      title,
      style,
      className,
      disabled,
      'aria-label': ariaLabel,
    } = props;

    const dims = DIM_TABLE[size];
    const colors = toneColors(tone, active);

    return (
      <button
        ref={ref}
        type="button"
        onClick={onClick}
        title={title}
        aria-label={ariaLabel}
        aria-pressed={active || undefined}
        disabled={disabled}
        className={className}
        style={{
          width: dims,
          height: dims,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: colors.bg,
          color: colors.color,
          border: 'none',
          borderRadius: 'var(--r-md)',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.5 : 1,
          transition: 'all var(--dur-fast) var(--ease-smooth)',
          ...style,
        }}
        onMouseEnter={(e) => {
          if (!active && !disabled) {
            e.currentTarget.style.background = 'var(--bg-hover)';
          }
        }}
        onMouseLeave={(e) => {
          if (!active && !disabled) {
            e.currentTarget.style.background = colors.bg;
          }
        }}
      >
        {typeof icon === 'string' ? (
          <Icon name={icon} size={ICON_TABLE[size]} />
        ) : (
          icon
        )}
      </button>
    );
  },
);

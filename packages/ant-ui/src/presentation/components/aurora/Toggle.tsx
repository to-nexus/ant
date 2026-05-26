
import * as React from 'react';

/**
 * Aurora Toggle — switch with spring-eased knob movement. Checked state uses
 * the violet→pink gradient with the `gradient-flow` animation class so it
 * subtly shifts.
 */

export interface ToggleProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  size?: 'sm' | 'md';
  disabled?: boolean;
  'aria-label'?: string;
  style?: React.CSSProperties;
  className?: string;
}

const DIMS = {
  sm: { w: 32, h: 18, k: 14, p: 2 },
  md: { w: 44, h: 24, k: 18, p: 3 },
} as const;

export function Toggle({
  checked,
  onChange,
  size = 'md',
  disabled,
  'aria-label': ariaLabel,
  style,
  className,
}: ToggleProps) {
  const dims = DIMS[size];
  const composed = [checked ? 'gradient-flow' : '', className]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => {
        if (!disabled) onChange(!checked);
      }}
      className={composed || undefined}
      style={{
        width: dims.w,
        height: dims.h,
        background: checked ? 'var(--gradient-violet-pink)' : 'var(--border-2)',
        backgroundSize: '200% 200%',
        borderRadius: 999,
        border: 'none',
        position: 'relative',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition: 'background var(--dur-base) var(--ease-smooth)',
        padding: dims.p,
        ...style,
      }}
    >
      <span
        aria-hidden
        style={{
          position: 'absolute',
          top: dims.p,
          left: checked ? dims.w - dims.k - dims.p : dims.p,
          width: dims.k,
          height: dims.k,
          borderRadius: '50%',
          background: 'white',
          boxShadow: 'var(--shadow-sm)',
          transition: 'left var(--dur-base) var(--ease-spring)',
        }}
      />
    </button>
  );
}

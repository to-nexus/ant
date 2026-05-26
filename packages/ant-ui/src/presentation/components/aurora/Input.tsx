
import * as React from 'react';
import { Icon } from './Icon';

/**
 * Aurora Input — single-line text field. Focus halo uses
 * `0 0 0 4px oklch(64% 0.20 290 / 0.15)` per ui.jsx.
 *
 * NOTE: `size` is also a native input attribute (number). We shadow it as a
 * string union to control visual sizing; the native numeric size attribute is
 * not exposed by the Aurora API.
 */

type NativeInputProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'size' | 'style' | 'children'
>;

export type InputSize = 'sm' | 'md' | 'lg';

export interface InputProps extends NativeInputProps {
  iconLeft?: string;
  iconRight?: string;
  invalid?: boolean;
  size?: InputSize;
  style?: React.CSSProperties;
  containerStyle?: React.CSSProperties;
  containerClassName?: string;
}

const SIZE_TABLE: Record<InputSize, { h: number; fs: number; px: number }> = {
  sm: { h: 34, fs: 13, px: 12 },
  md: { h: 40, fs: 14, px: 14 },
  lg: { h: 48, fs: 15, px: 16 },
};

export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  props,
  ref,
) {
  const {
    iconLeft,
    iconRight,
    invalid = false,
    size = 'md',
    style,
    containerStyle,
    containerClassName,
    className,
    onFocus,
    onBlur,
    ...rest
  } = props;

  const [focused, setFocused] = React.useState(false);
  const s = SIZE_TABLE[size];

  const borderColor = invalid
    ? 'var(--red-500)'
    : focused
      ? 'var(--violet-400)'
      : 'var(--border-2)';

  return (
    <div
      className={containerClassName}
      style={{ position: 'relative', ...containerStyle }}
    >
      {iconLeft && (
        <Icon
          name={iconLeft}
          size={16}
          style={{
            position: 'absolute',
            left: 14,
            top: '50%',
            transform: 'translateY(-50%)',
            color: focused ? 'var(--violet-500)' : 'var(--text-3)',
            transition: 'color var(--dur-fast)',
            pointerEvents: 'none',
          }}
        />
      )}
      <input
        ref={ref}
        className={className}
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
        style={{
          width: '100%',
          height: s.h,
          padding: iconLeft
            ? `0 ${iconRight ? 38 : s.px}px 0 38px`
            : `0 ${iconRight ? 38 : s.px}px 0 ${s.px}px`,
          background: 'var(--bg-surface)',
          color: 'var(--text-1)',
          border: `1.5px solid ${borderColor}`,
          borderRadius: 'var(--r-md)',
          fontSize: s.fs,
          fontFamily: 'inherit',
          outline: 'none',
          transition:
            'border-color var(--dur-fast) var(--ease-smooth), box-shadow var(--dur-fast) var(--ease-smooth)',
          boxShadow: focused ? '0 0 0 4px oklch(64% 0.20 290 / 0.15)' : 'none',
          ...style,
        }}
        {...rest}
      />
      {iconRight && (
        <Icon
          name={iconRight}
          size={16}
          style={{
            position: 'absolute',
            right: 14,
            top: '50%',
            transform: 'translateY(-50%)',
            color: focused ? 'var(--violet-500)' : 'var(--text-3)',
            transition: 'color var(--dur-fast)',
            pointerEvents: 'none',
          }}
        />
      )}
    </div>
  );
});

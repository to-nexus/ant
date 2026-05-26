
import * as React from 'react';

/**
 * Aurora Textarea — multi-line text field. Mirrors Input's focus / invalid
 * styling but with multi-line padding, min-height 96, and vertical resize.
 */

type NativeTextareaProps = Omit<
  React.TextareaHTMLAttributes<HTMLTextAreaElement>,
  'style'
>;

export interface TextareaProps extends NativeTextareaProps {
  invalid?: boolean;
  style?: React.CSSProperties;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea(props, ref) {
    const { invalid = false, style, onFocus, onBlur, className, ...rest } = props;
    const [focused, setFocused] = React.useState(false);

    const borderColor = invalid
      ? 'var(--red-500)'
      : focused
        ? 'var(--violet-400)'
        : 'var(--border-2)';

    return (
      <textarea
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
          minHeight: 96,
          padding: '12px 14px',
          background: 'var(--bg-surface)',
          color: 'var(--text-1)',
          border: `1.5px solid ${borderColor}`,
          borderRadius: 'var(--r-md)',
          fontSize: 14,
          fontFamily: 'inherit',
          outline: 'none',
          resize: 'vertical',
          transition:
            'border-color var(--dur-fast) var(--ease-smooth), box-shadow var(--dur-fast) var(--ease-smooth)',
          boxShadow: focused ? '0 0 0 4px oklch(64% 0.20 290 / 0.15)' : 'none',
          ...style,
        }}
        {...rest}
      />
    );
  },
);

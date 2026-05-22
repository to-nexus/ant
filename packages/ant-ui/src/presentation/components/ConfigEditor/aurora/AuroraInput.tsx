
import { useState } from 'react';
import type { KeyboardEventHandler, ReactNode } from 'react';

export interface AuroraInputProps {
  value?: string;
  onChange?: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
  hasError?: boolean;
  type?: 'text' | 'password' | 'email' | 'url';
  mono?: boolean;
  prefix?: ReactNode;
  suffix?: ReactNode;
  onKeyDown?: KeyboardEventHandler<HTMLInputElement>;
  id?: string;
  name?: string;
  autoComplete?: string;
}

export function AuroraInput({
  value,
  onChange,
  placeholder,
  disabled = false,
  hasError = false,
  type = 'text',
  mono = false,
  prefix,
  suffix,
  onKeyDown,
  id,
  name,
  autoComplete,
}: AuroraInputProps) {
  const [focused, setFocused] = useState(false);

  const borderColor = hasError
    ? 'var(--status-error-fg)'
    : focused
      ? 'var(--violet-400)'
      : 'var(--border-2)';

  const focusShadow = focused
    ? hasError
      ? '0 0 0 4px oklch(64% 0.20 25 / 0.15)'
      : '0 0 0 4px oklch(64% 0.20 290 / 0.15)'
    : 'none';

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'stretch',
        background: disabled ? 'var(--bg-surface-2)' : 'var(--bg-surface)',
        border: `1px solid ${borderColor}`,
        borderRadius: 'var(--r-md)',
        overflow: 'hidden',
        boxShadow: focusShadow,
        transition:
          'border-color 0.15s ease, box-shadow 0.15s ease, background 0.15s ease',
      }}
    >
      {prefix && (
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            padding: '0 10px',
            background: 'var(--bg-surface-2)',
            borderRight: '1px solid var(--border-1)',
            color: 'var(--text-3)',
            fontSize: 12,
            fontFamily: mono ? 'var(--font-mono)' : 'inherit',
          }}
        >
          {prefix}
        </div>
      )}
      <input
        id={id}
        name={name}
        type={type}
        value={value ?? ''}
        onChange={(e) => onChange?.(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete={autoComplete}
        style={{
          flex: 1,
          minWidth: 0,
          height: 36,
          padding: '0 12px',
          fontSize: 13,
          fontFamily: mono ? 'var(--font-mono)' : 'inherit',
          background: 'transparent',
          border: 'none',
          outline: 'none',
          color: disabled ? 'var(--text-3)' : 'var(--text-1)',
        }}
      />
      {suffix && (
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            padding: '0 10px',
            background: 'var(--bg-surface-2)',
            borderLeft: '1px solid var(--border-1)',
            color: 'var(--text-3)',
            fontSize: 12,
          }}
        >
          {suffix}
        </div>
      )}
    </div>
  );
}

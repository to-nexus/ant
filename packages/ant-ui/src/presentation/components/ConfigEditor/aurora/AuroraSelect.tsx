
import { useState } from 'react';
import { ChevronDown } from 'lucide-react';

export interface AuroraSelectOption {
  value: string;
  label: string;
  /** Options sharing a group label render inside a native <optgroup>. */
  group?: string;
}

export interface AuroraSelectProps {
  value?: string;
  onChange?: (v: string) => void;
  options: AuroraSelectOption[];
  placeholder?: string;
  disabled?: boolean;
  hasError?: boolean;
  id?: string;
  name?: string;
  autoFocus?: boolean;
}

export function AuroraSelect({
  value,
  onChange,
  options,
  placeholder,
  disabled = false,
  hasError = false,
  id,
  name,
  autoFocus = false,
}: AuroraSelectProps) {
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
        position: 'relative',
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
      <select
        id={id}
        name={name}
        autoFocus={autoFocus}
        value={value ?? ''}
        onChange={(e) => onChange?.(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        disabled={disabled}
        style={{
          flex: 1,
          minWidth: 0,
          height: 36,
          padding: '0 32px 0 12px',
          fontSize: 13,
          background: 'transparent',
          border: 'none',
          outline: 'none',
          color: disabled ? 'var(--text-3)' : 'var(--text-1)',
          appearance: 'none',
          WebkitAppearance: 'none',
          MozAppearance: 'none',
          cursor: disabled ? 'not-allowed' : 'pointer',
        }}
      >
        {placeholder && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {/* Preserve declaration order: consecutive same-group options fold into one optgroup. */}
        {options
          .reduce<Array<{ group?: string; items: AuroraSelectOption[] }>>((acc, opt) => {
            const last = acc[acc.length - 1];
            if (last && last.group === opt.group) last.items.push(opt);
            else acc.push({ group: opt.group, items: [opt] });
            return acc;
          }, [])
          .map((bucket, bi) =>
            bucket.group != null ? (
              <optgroup key={`g-${bi}-${bucket.group}`} label={bucket.group}>
                {bucket.items.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </optgroup>
            ) : (
              bucket.items.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))
            ),
          )}
      </select>
      <span
        aria-hidden
        style={{
          position: 'absolute',
          top: 0,
          right: 8,
          bottom: 0,
          display: 'inline-flex',
          alignItems: 'center',
          pointerEvents: 'none',
          color: 'var(--text-3)',
        }}
      >
        <ChevronDown size={14} strokeWidth={2} />
      </span>
    </div>
  );
}

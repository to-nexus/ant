
import type { ReactNode } from 'react';

export interface FieldLabelProps {
  children: ReactNode;
  required?: boolean;
  optional?: boolean;
  action?: ReactNode;
  htmlFor?: string;
}

export function FieldLabel({
  children,
  required = false,
  optional = false,
  action,
  htmlFor,
}: FieldLabelProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
        marginBottom: 6,
      }}
    >
      <label
        htmlFor={htmlFor}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          fontSize: 12,
          fontWeight: 700,
          color: 'var(--text-2)',
          letterSpacing: '-0.005em',
        }}
      >
        {children}
        {required && (
          <span
            aria-hidden
            style={{ color: 'var(--status-error-fg)' }}
          >
            *
          </span>
        )}
      </label>
      {action ? (
        <span style={{ display: 'inline-flex', alignItems: 'center' }}>
          {action}
        </span>
      ) : optional ? (
        <span
          style={{
            fontSize: 10,
            color: 'var(--text-4)',
            fontStyle: 'italic',
          }}
        >
          선택사항
        </span>
      ) : null}
    </div>
  );
}

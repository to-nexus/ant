/**
 * Label → control → hint, in that order, once. The inspector had this trio
 * hand-assembled in every field with drifting margins; the parent column's
 * `gap` owns the spacing between fields, this owns the spacing inside one.
 */

import type { ReactNode } from 'react';
import { FieldHint, FieldLabel } from '../../../ConfigEditor/aurora';
import { HintBadge } from '../../../common/HintBadge';

export interface FieldProps {
  label: string;
  required?: boolean;
  optional?: boolean;
  /** One sentence under the control. */
  hint?: ReactNode;
  /** Longer explanation behind an (i) badge beside the label. */
  help?: string;
  /** Replaces the hint in error tone when set. */
  error?: string | null;
  action?: ReactNode;
  children: ReactNode;
}

export function Field({ label, required, optional, hint, help, error, action, children }: FieldProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      <FieldLabel required={required} optional={optional} action={action}>
        {help ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            {label}
            <HintBadge isCompact label={label} tooltip={help} />
          </span>
        ) : (
          label
        )}
      </FieldLabel>
      {children}
      {error ? (
        <FieldHint tone="error" spacing="above">
          {error}
        </FieldHint>
      ) : hint ? (
        <FieldHint tone="muted" spacing="above">
          {hint}
        </FieldHint>
      ) : null}
    </div>
  );
}

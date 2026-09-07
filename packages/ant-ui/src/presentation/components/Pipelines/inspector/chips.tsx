/**
 * The inspector's ONE chip vocabulary — aurora `Chip` in two compact sizes.
 * Token chips insert a literal (`{{run.id}}`, a stop glob) at the caret;
 * toggle chips are multi-select state (needs, statuses, verdict outcomes).
 */

import type { CSSProperties, MouseEventHandler, ReactNode } from 'react';
import { Chip } from '../../aurora';

const TOKEN_STYLE: CSSProperties = { height: 22, padding: '0 8px', gap: 4, fontSize: 10.5, fontWeight: 500, fontFamily: 'var(--font-mono)' };
const TOGGLE_STYLE: CSSProperties = { height: 24, padding: '0 10px', gap: 4, fontSize: 11, fontWeight: 600 };

interface ChipBaseProps {
  children: ReactNode;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  disabled?: boolean;
  title?: string;
  'aria-label'?: string;
}

export function TokenChip({ children, onClick, disabled, title, 'aria-label': ariaLabel }: ChipBaseProps) {
  return (
    <Chip style={TOKEN_STYLE} onClick={onClick} disabled={disabled} title={title} aria-label={ariaLabel}>
      {children}
    </Chip>
  );
}

export function ToggleChip({ children, active, onClick, disabled, title }: ChipBaseProps & { active: boolean }) {
  return (
    <Chip style={TOGGLE_STYLE} active={active} onClick={onClick} disabled={disabled} title={title}>
      {children}
    </Chip>
  );
}

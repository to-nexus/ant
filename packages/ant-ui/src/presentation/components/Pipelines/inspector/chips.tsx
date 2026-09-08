/**
 * The inspector's ONE chip vocabulary — aurora `Chip` in two compact sizes.
 * Token chips insert a literal (`{{run.id}}`, a stop glob) at the caret;
 * toggle chips are multi-select state (needs, statuses, verdict outcomes);
 * token PILLS are read-only — they stand in for a `{{…}}` occurrence inside
 * authored text, so they must not look or behave like a button.
 */

import type { CSSProperties, MouseEventHandler, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
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

/** Read-only pill tones — a token's role, never its identity. */
export type TokenPillTone = 'static' | 'stepOutput' | 'unknown';

const PILL_TONE: Record<TokenPillTone, { accent: string }> = {
  static: { accent: 'var(--violet-500)' },
  stepOutput: { accent: 'var(--teal-500)' },
  unknown: { accent: 'var(--red-500)' },
};

/**
 * One `{{…}}` occurrence, rendered as the words it means. Non-interactive by
 * design: the textarea above holds the real bytes, and this only explains
 * them. An `unknown` tone must still RENDER — a token the validator will
 * refuse has to be visible as wrong, never silently absent.
 */
export function TokenPill({ tone, icon: Icon, children, title }: { tone: TokenPillTone; icon?: LucideIcon; children: ReactNode; title?: string }) {
  const { accent } = PILL_TONE[tone];
  return (
    <span
      title={title}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 3,
        verticalAlign: 'baseline',
        margin: '0 1px',
        padding: '1px 6px',
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 600,
        lineHeight: '16px',
        background: `color-mix(in srgb, ${accent} 14%, transparent)`,
        color: accent,
        border: tone === 'unknown' ? `1px dashed ${accent}` : '1px solid transparent',
      }}
    >
      {Icon && <Icon size={10} />}
      {children}
    </span>
  );
}

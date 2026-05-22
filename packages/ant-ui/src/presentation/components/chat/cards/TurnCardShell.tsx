
/**
 * TurnCardShell - Shared Aurora card-surface wrapper for chat-card family.
 *
 * Provides the canonical Aurora surface (var(--bg-surface) + 1px var(--border-1)
 * + var(--r-md) radius + hover lift via .turn-card-hover utility) so each card
 * component composes a consistent shell instead of duplicating surface markup.
 *
 * Accent variants paint a 3px left inset strip via box-shadow so they do not
 * affect child layout. Dark/light theme is auto-handled by var(--…) tokens.
 */

import { memo, forwardRef } from 'react';
import type { HTMLAttributes, CSSProperties, ReactNode } from 'react';

export type TurnCardAccent = 'default' | 'success' | 'warning' | 'error' | 'info';

export interface TurnCardShellProps {
  /** Accent strip color variant (rendered as inset 3px left box-shadow). */
  accent?: TurnCardAccent;
  /** When true, applies translateY(-1px) + shadow-md on :hover via .turn-card-hover. */
  hoverLift?: boolean;
  /** When true, uses var(--bg-surface-2) instead of var(--bg-surface). */
  nested?: boolean;
  /** Optional inline style merged onto the root. */
  style?: CSSProperties;
  /** Optional className appended to the root. */
  className?: string;
  children?: ReactNode;
}

function accentColor(accent: TurnCardAccent): string {
  switch (accent) {
    case 'success': return 'var(--status-done-fg)';
    case 'warning': return 'var(--amber-500)';
    case 'error':   return 'var(--red-500)';
    case 'info':    return 'var(--violet-500)';
    case 'default':
    default:        return 'transparent';
  }
}

type DivProps = Omit<HTMLAttributes<HTMLDivElement>, 'style' | 'className'>;
type TurnCardShellRootProps = TurnCardShellProps & DivProps;

const TurnCardShellInner = forwardRef<HTMLDivElement, TurnCardShellRootProps>(
  function TurnCardShellInner(
    { accent = 'default', hoverLift = false, nested = false, style, className, children, ...rest },
    ref,
  ) {
    const stripColor = accentColor(accent);
    const baseStyle: CSSProperties = {
      background: nested ? 'var(--bg-surface-2)' : 'var(--bg-surface)',
      border: '1px solid var(--border-1)',
      borderRadius: 'var(--r-md)',
      overflow: 'hidden',
      transition:
        'transform var(--dur-fast) var(--ease-smooth), ' +
        'box-shadow var(--dur-fast) var(--ease-smooth), ' +
        'border-color var(--dur-fast) var(--ease-smooth)',
      ...(accent !== 'default' ? { boxShadow: `inset 3px 0 0 0 ${stripColor}` } : {}),
      ...style,
    };
    const classes = [hoverLift ? 'turn-card-hover' : '', className || ''].filter(Boolean).join(' ');
    return (
      <div ref={ref} className={classes || undefined} style={baseStyle} {...rest}>
        {children}
      </div>
    );
  },
);

export const TurnCardShell = memo(TurnCardShellInner);

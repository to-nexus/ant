import type { CSSProperties, ReactNode } from 'react';
import { PROSE_MEASURE, PROSE_WRAP } from './measures';

/**
 * Field hint — the ONE anatomy for explanatory copy under a label, a control,
 * or inside a card body.
 *
 * It exists because these paragraphs had drifted across the settings screens
 * into three sizes (10.5 / 11 / 11.5px), two colors (`--text-3` / `--text-4`)
 * and four hand-written margins, so sibling fields explained themselves at
 * visibly different weights and spacings.
 *
 * Two rules the callers must keep:
 *   - Spacing belongs to the PARENT (a flex column's `gap`). `spacing` is for
 *     plain block parents only — a hint that carries its own margin inside a
 *     gapped column doubles that gap.
 *   - Width is the PROSE measure, never the control's. A hint wrapped by the
 *     420px box an input needs becomes a third text column in the same card.
 */
export type FieldHintTone = 'default' | 'muted' | 'warn';

const TONE_COLOR: Record<FieldHintTone, string> = {
  default: 'var(--text-3)',
  muted: 'var(--text-4)',
  warn: 'var(--amber-500, var(--text-3))',
};

const SPACING_MARGIN: Record<'none' | 'above' | 'below', string> = {
  none: '0',
  above: '8px 0 0',
  below: '0 0 10px',
};

export interface FieldHintProps {
  children: ReactNode;
  tone?: FieldHintTone;
  /** Margin for block parents that provide no `gap`. Default `none`. */
  spacing?: 'none' | 'above' | 'below';
  /** Escape hatch for hints that annotate a full-width body (tables, chip grids). */
  style?: CSSProperties;
}

export function FieldHint({ children, tone = 'default', spacing = 'none', style }: FieldHintProps) {
  return (
    <p
      style={{
        margin: SPACING_MARGIN[spacing],
        maxWidth: PROSE_MEASURE,
        ...PROSE_WRAP,
        fontSize: 11.5,
        lineHeight: 1.55,
        color: TONE_COLOR[tone],
        ...style,
      }}
    >
      {children}
    </p>
  );
}

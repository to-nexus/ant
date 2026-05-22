
import * as React from 'react';
import type { LucideIcon } from 'lucide-react';
import { Tooltip } from '@/presentation/components/common/Tooltip';

/**
 * Section — Compact labelled block used inside the Actions/config panel
 * (ActionConfigView).
 *
 * Distinct from `presentation/components/aurora/Section.tsx`, which is a
 * large display-font section with eyebrow/subtitle/action — that contract
 * does not fit ActionConfigView's call sites. This local Section renders:
 *
 *   ┌─────────────────────────────────────────────┐
 *   │ <icon> Title              <hint chip>       │
 *   ├─────────────────────────────────────────────┤
 *   │ children…                                   │
 *   └─────────────────────────────────────────────┘
 *
 * Hint chip surfaces a short label (e.g. "Optional", "Mirrors refs") with
 * an optional tooltip; `colorScheme` selects a muted swatch.
 */

export type SectionHintColor = 'gray' | 'amber' | 'blue' | 'violet' | 'emerald' | 'orange';

export interface SectionHint {
  label: string;
  tooltip?: string;
  colorScheme?: SectionHintColor;
}

export interface SectionProps {
  title: string;
  /** Lucide icon component rendered before the title. */
  icon?: LucideIcon;
  /** Tailwind text-color class for the icon, e.g. `text-[var(--violet-500)]`. */
  iconColor?: string;
  hint?: SectionHint;
  children?: React.ReactNode;
}

const HINT_CLASSES: Record<SectionHintColor, string> = {
  gray:    'bg-[var(--bg-surface-2)] text-[var(--text-3)] border-[var(--border-2)]',
  amber:   'bg-amber-50 text-amber-700 border-amber-200',
  blue:    'bg-blue-50 text-blue-700 border-blue-200',
  violet:  'bg-violet-50 text-violet-700 border-violet-200',
  emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  orange:  'bg-orange-50 text-orange-700 border-orange-200',
};

function HintChip({ hint }: { hint: SectionHint }) {
  const scheme = hint.colorScheme ?? 'gray';
  const chipClass = HINT_CLASSES[scheme] ?? HINT_CLASSES.gray;
  const chip = (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border ${chipClass}`}
    >
      {hint.label}
    </span>
  );
  if (!hint.tooltip) return chip;
  return (
    <Tooltip content={hint.tooltip} placement="top">
      <span className="inline-flex cursor-help">{chip}</span>
    </Tooltip>
  );
}

export function Section({ title, icon: Icon, iconColor, hint, children }: SectionProps) {
  return (
    <section className="mb-1">
      <header className="flex items-center justify-between gap-2 mb-2 px-1">
        <div className="flex items-center gap-1.5 min-w-0">
          {Icon && (
            <Icon
              size={14}
              className={iconColor ?? 'text-[var(--text-2)]'}
              aria-hidden
            />
          )}
          <h3
            className="text-[13px] font-semibold truncate"
            style={{ color: 'var(--text-1)' }}
          >
            {title}
          </h3>
        </div>
        {hint && <HintChip hint={hint} />}
      </header>
      <div>{children}</div>
    </section>
  );
}

/**
 * The inspector's ONE grouping device — a card with an icon orb, a title, one
 * sentence of purpose and an optional status badge. Every panel (trigger, job
 * step, gate) is a column of these, so an author reads the same silhouette
 * everywhere: what this block is FOR, then its fields. `step` numbers the
 * cards of a guided flow (the fetch trigger's connect → request → map → poll).
 */

import { useState, type ReactNode } from 'react';
import { ChevronDown, type LucideIcon } from 'lucide-react';
import { FieldHint } from '../../../ConfigEditor/aurora';

export type InspectorSectionStatus = 'todo' | 'ok' | 'warn';

export interface InspectorSectionProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  /** Node-kind accent (`NODE_KIND_STYLE[kind].accent`); defaults to the step accent. */
  accent?: string;
  /** 1-based position in a guided flow — rendered as a numbered orb instead of the icon. */
  step?: number;
  status?: InspectorSectionStatus;
  /** Short status text beside the badge (a count, "3 headers", …). */
  statusLabel?: string;
  /** Trailing header control. */
  action?: ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
  children: ReactNode;
  'data-section'?: string;
}

const STATUS_COLOR: Record<InspectorSectionStatus, string> = {
  todo: 'var(--text-4)',
  ok: 'var(--status-done-fg)',
  warn: 'var(--amber-500)',
};

export function InspectorSection({
  icon: Icon,
  title,
  description,
  accent = 'var(--violet-500)',
  step,
  status,
  statusLabel,
  action,
  collapsible = false,
  defaultOpen = true,
  children,
  'data-section': dataSection,
}: InspectorSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const expanded = collapsible ? open : true;
  return (
    <section
      data-section={dataSection}
      style={{
        flexShrink: 0,
        border: '1px solid var(--border-1)',
        borderRadius: 'var(--r-lg)',
        background: 'var(--bg-surface)',
        boxShadow: `inset 3px 0 0 ${accent}`,
        overflow: 'hidden',
      }}
    >
      <header
        onClick={collapsible ? () => setOpen((o) => !o) : undefined}
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 10,
          padding: '10px 12px 10px 14px',
          cursor: collapsible ? 'pointer' : 'default',
          userSelect: 'none',
        }}
      >
        <span
          aria-hidden
          style={{
            width: 24,
            height: 24,
            borderRadius: 8,
            flexShrink: 0,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: `color-mix(in srgb, ${accent} 16%, transparent)`,
            color: accent,
            fontSize: 11.5,
            fontWeight: 700,
            fontFamily: 'var(--font-mono)',
          }}
        >
          {step !== undefined ? step : <Icon size={13} />}
        </span>
        <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-1)', letterSpacing: '-0.005em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</span>
            {status && (
              <span
                data-status={status}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  fontSize: 10.5,
                  fontWeight: 600,
                  color: STATUS_COLOR[status],
                  whiteSpace: 'nowrap',
                }}
              >
                <span aria-hidden style={{ width: 6, height: 6, borderRadius: 3, background: 'currentColor' }} />
                {statusLabel}
              </span>
            )}
          </span>
          {description && (
            <FieldHint tone="muted" style={{ fontSize: 11, lineHeight: 1.5 }}>
              {description}
            </FieldHint>
          )}
        </span>
        {action && <span onClick={(e) => e.stopPropagation()} style={{ display: 'inline-flex', alignItems: 'center', flexShrink: 0 }}>{action}</span>}
        {collapsible && (
          <ChevronDown size={14} style={{ color: 'var(--text-3)', flexShrink: 0, marginTop: 5, transition: 'transform 120ms ease', transform: expanded ? 'none' : 'rotate(-90deg)' }} />
        )}
      </header>
      {expanded && (
        <div style={{ padding: '2px 14px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {children}
        </div>
      )}
    </section>
  );
}

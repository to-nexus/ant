import { useState, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';

export type SectionAccent = 'violet' | 'pink' | 'orange' | 'cool';

interface SectionShellProps {
  eyebrow: string;
  /** Optional count chip. When `null`/`undefined`, no chip is rendered. */
  count?: number | null;
  /** Accent for the count chip. Default: violet. */
  accent?: SectionAccent;
  /** Right-aligned action slot (buttons / badges). Shown only when expanded. */
  action?: ReactNode;
  /** Optional indicator slot rendered before the count chip (expanded state). */
  indicator?: ReactNode;
  /** Initial expanded state. */
  expanded?: boolean;
  /** When collapsed, replace eyebrow title with this label (e.g. selected item name). */
  collapsedLabel?: string;
  /** Right-aligned action slot shown only when collapsed AND `collapsedLabel` is set. */
  collapsedAction?: ReactNode;
  children: ReactNode;
}

const ACCENT_VAR: Record<SectionAccent, string> = {
  violet: 'var(--violet-500)',
  pink: 'var(--pink-500)',
  orange: 'var(--orange-500)',
  cool: 'var(--teal-500)',
};

/**
 * Section header shell shared by Project / Feature / Artifacts panels.
 *
 * Mirrors `b3-explorer.jsx::ExplorerSection` (handoff B3):
 *   ┌ chevron ─ eyebrow (uppercase) ─ [indicator] ─ [count chip] ── action ┐
 *   └ children                                                              ┘
 *
 * When collapsed AND `collapsedLabel` is provided, the title row becomes:
 *   ┌ chevron ─ [accent badge with eyebrow] ─ collapsedLabel (mono) ── collapsedAction ┐
 *   (children hidden)
 *
 * The count chip is suppressed entirely when `count` is `null` /
 * `undefined`. Artifacts therefore never renders a number on its
 * header (spec §1.1.6).
 */
export function SectionShell({
  eyebrow,
  count,
  accent = 'violet',
  action,
  indicator,
  expanded = true,
  collapsedLabel,
  collapsedAction,
  children,
}: SectionShellProps) {
  const [open, setOpen] = useState(expanded);
  const accentColor = ACCENT_VAR[accent];
  const showCollapsedLabel = !open && !!collapsedLabel;
  const showCount = open && count != null;

  return (
    <section style={{ marginBottom: 4 }}>
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          paddingRight: 6,
        }}
      >
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          style={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '7px 10px',
            border: 'none',
            background: 'transparent',
            fontFamily: 'inherit',
            cursor: 'pointer',
            borderRadius: 'var(--r-sm)',
            textAlign: 'left',
            transition: 'color var(--dur-fast), font-size var(--dur-fast)',
          }}
        >
          <ChevronRight
            size={10}
            style={{
              transform: open ? 'rotate(90deg)' : 'none',
              transition: 'transform 200ms',
              flexShrink: 0,
              color: 'var(--text-3)',
            }}
          />
          {showCollapsedLabel ? (
            <>
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: 0.5,
                  color: accentColor,
                  background: `color-mix(in srgb, ${accentColor} 14%, transparent)`,
                  padding: '1px 6px',
                  borderRadius: 999,
                  flexShrink: 0,
                }}
              >
                {eyebrow}
              </span>
              <span
                className="font-mono"
                style={{
                  flex: 1,
                  minWidth: 0,
                  fontSize: 12,
                  fontWeight: 600,
                  color: 'var(--text-1)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {collapsedLabel}
              </span>
            </>
          ) : (
            <>
              <span
                style={{
                  fontSize: 10.5,
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: 0.7,
                  color: 'var(--text-3)',
                }}
              >
                {eyebrow}
              </span>
              <span style={{ flex: 1 }} />
            </>
          )}
          {!showCollapsedLabel && indicator}
          {showCount && (
            <span
              style={{
                padding: '1px 7px',
                borderRadius: 999,
                background: `color-mix(in srgb, ${accentColor} 14%, transparent)`,
                color: accentColor,
                fontSize: 10,
                fontWeight: 800,
              }}
            >
              {count}
            </span>
          )}
        </button>
        {open
          ? action && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  flexShrink: 0,
                }}
              >
                {action}
              </div>
            )
          : showCollapsedLabel && collapsedAction && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  flexShrink: 0,
                }}
              >
                {collapsedAction}
              </div>
            )}
      </header>
      {open && <div style={{ padding: '4px 0 6px' }}>{children}</div>}
    </section>
  );
}

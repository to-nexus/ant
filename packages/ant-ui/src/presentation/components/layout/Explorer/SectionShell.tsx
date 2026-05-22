
import type { ReactNode } from 'react';

export type SectionAccent = 'violet' | 'pink' | 'orange' | 'cool';

interface SectionShellProps {
  eyebrow: string;
  /** Optional count chip. When `null`/`undefined`, no chip is rendered. */
  count?: number | null;
  /** Accent for the count chip. Default: violet. */
  accent?: SectionAccent;
  /** Right-aligned action slot (buttons / badges). */
  action?: ReactNode;
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
 * Pattern (mirrors A2 ExplorerSection from the b3-explorer handoff):
 *   ┌ eyebrow (uppercase, 11px, letter-spaced) ─ [count chip] ── action ┐
 *   └ children                                                           ┘
 *
 * The count chip is suppressed entirely when `count` is `null` /
 * `undefined`. Artifacts therefore never renders a number on its
 * header (spec §1.1.6) — it only renders an action slot containing the
 * 「전송」 button + optional red dot badge.
 */
export function SectionShell({
  eyebrow,
  count,
  accent = 'violet',
  action,
  children,
}: SectionShellProps) {
  const showCount = count != null;
  return (
    <section className="mb-3">
      <header
        className="flex items-center justify-between mb-2 px-1"
        style={{ minHeight: 18 }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="font-semibold uppercase tracking-wider truncate"
            style={{
              fontSize: 11,
              letterSpacing: '0.08em',
              color: 'var(--text-2)',
            }}
          >
            {eyebrow}
          </span>
          {showCount && (
            <span
              className="inline-flex items-center justify-center"
              style={{
                minWidth: 18,
                height: 18,
                padding: '0 6px',
                borderRadius: 9,
                fontSize: 10,
                fontWeight: 600,
                background: `color-mix(in srgb, ${ACCENT_VAR[accent]} 18%, transparent)`,
                color: ACCENT_VAR[accent],
                border: `1px solid color-mix(in srgb, ${ACCENT_VAR[accent]} 28%, transparent)`,
              }}
            >
              {count}
            </span>
          )}
        </div>
        {action && (
          <div className="flex items-center gap-1.5 shrink-0">{action}</div>
        )}
      </header>
      {children}
    </section>
  );
}

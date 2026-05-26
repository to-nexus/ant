import type { JSX } from 'react';
import type { LucideIcon } from 'lucide-react';

/**
 * BoardViewModeToggle — pill segmented control for view-mode selection.
 *
 * Ported from visual/ui/handoff/project/a2-workspace.jsx::BoardToggle (L289–L335).
 * Used in MainPanelTabsBar to switch between Kanban / Workflow boards. The
 * surrounding chrome already names the current board via the active pill, so
 * the BoardContainer header no longer renders a redundant title text.
 *
 * Styling: inline + Aurora CSS variables only — no Tailwind palette / `dark:`.
 * Active pill draws an aurora gradient underline (uses `.gradient-flow`
 * keyframe class defined in `aurora-tokens.css`).
 *
 * Accessibility: the wrapping container exposes `role="group"` + `aria-label`
 * (caller-provided, already translated). Each option button carries
 * `aria-pressed` reflecting active state, so screen readers can announce
 * the current view without a sibling heading.
 */

export interface BoardViewModeToggleOption<V extends string = string> {
  id: V;
  label: string;
  icon: LucideIcon;
}

export interface BoardViewModeToggleProps<V extends string = string> {
  value: V;
  onChange: (value: V) => void;
  options: ReadonlyArray<BoardViewModeToggleOption<V>>;
  ariaLabel: string;
}

export function BoardViewModeToggle<V extends string = string>(
  props: BoardViewModeToggleProps<V>,
): JSX.Element {
  const { value, onChange, options, ariaLabel } = props;
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      style={{
        display: 'inline-flex',
        gap: 3,
        padding: 3,
        background: 'var(--bg-surface-2)',
        border: '1px solid var(--border-2)',
        borderRadius: 'var(--r-pill)',
        boxShadow: 'var(--shadow-xs)',
      }}
    >
      {options.map((opt) => {
        const active = value === opt.id;
        const IconComp = opt.icon;
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => onChange(opt.id)}
            aria-pressed={active}
            aria-label={opt.label}
            style={{
              position: 'relative',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 14px',
              borderRadius: 999,
              background: active ? 'var(--bg-surface)' : 'transparent',
              color: active ? 'var(--violet-700)' : 'var(--text-3)',
              border: 'none',
              fontFamily: 'inherit',
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
              boxShadow: active ? 'var(--shadow-xs)' : 'none',
              transition: 'all var(--dur-base) var(--ease-spring)',
            }}
          >
            <IconComp size={13} aria-hidden="true" />
            <span>{opt.label}</span>
            {active && (
              <span
                aria-hidden="true"
                className="gradient-flow"
                style={{
                  position: 'absolute',
                  bottom: -3,
                  left: 12,
                  right: 12,
                  height: 2,
                  background: 'var(--gradient-aurora)',
                  backgroundSize: '200% 200%',
                  borderRadius: 2,
                }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

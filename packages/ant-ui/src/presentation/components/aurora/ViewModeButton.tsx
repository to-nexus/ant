
import type { JSX } from 'react';
import type { LucideIcon } from 'lucide-react';

/**
 * Aurora ViewModeButton — ported verbatim from
 * visual/ui/handoff/project/shared.jsx::ViewModeButton (L113–L138).
 *
 * Segmented-control button used in MainPanelTabsBar's right slot to switch
 * between task view modes (Kanban / Workflow). Styling is inline + Aurora CSS
 * variables only — no Tailwind palette classes, no raw hex, no `dark:` prefix.
 */

export interface ViewModeButtonProps {
  icon: LucideIcon;
  label: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  title?: string;
  /** Toolbar metrics (h-20 pill) instead of the section-header metrics. */
  compact?: boolean;
}

export function ViewModeButton(props: ViewModeButtonProps): JSX.Element {
  const { icon, label, active, disabled, onClick, title, compact } = props;
  const IconComp = icon;
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: compact ? 4 : 6,
        height: compact ? 20 : undefined,
        padding: compact ? '0 8px' : '5px 12px',
        borderRadius: 'var(--r-sm)',
        background: active ? 'var(--bg-surface)' : 'transparent',
        border: active ? '1px solid var(--violet-200)' : '1px solid transparent',
        boxShadow: active ? 'var(--shadow-xs)' : 'none',
        color: active
          ? 'var(--violet-700)'
          : disabled
            ? 'var(--text-4)'
            : 'var(--text-3)',
        opacity: disabled ? 0.55 : 1,
        fontSize: compact ? 11 : 12,
        fontWeight: 600,
        fontFamily: 'inherit',
        cursor: disabled ? 'not-allowed' : 'pointer',
        transition: 'all var(--dur-fast)',
      }}
    >
      <IconComp size={compact ? 12 : 14} />
      <span>{label}</span>
    </button>
  );
}

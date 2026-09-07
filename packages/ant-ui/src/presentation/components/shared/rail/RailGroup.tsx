import { Children, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { CollapseToggle } from './CollapseToggle';
import { RAIL_EMPTY_STYLE, RAIL_GROUP_HEADER_CLASS } from './railTokens';

export interface RailGroupProps {
  label: string;
  icon?: LucideIcon;
  /** Header badge beside the label (e.g. a uniformly-readonly pill, a count). */
  pill?: ReactNode;
  /** Shown in the header while collapsed (rows hidden). */
  count?: number;
  collapsed?: boolean;
  /** Present ⇒ the group collapses (header click + chevron); absent ⇒ always open. */
  onToggle?: () => void;
  toggleLabel?: string;
  /** Rendered in place of the rows when there are none. */
  emptyText?: string;
  children?: ReactNode;
}

/** Scope group — header always renders, so an empty group stays distinguishable from a missing one. */
export function RailGroup({ label, icon: Icon, pill, count, collapsed = false, onToggle, toggleLabel, emptyText, children }: RailGroupProps) {
  const rows = Children.toArray(children);
  return (
    <div className="flex flex-col gap-0.5">
      <div
        className={`${RAIL_GROUP_HEADER_CLASS}${onToggle ? ' cursor-pointer select-none' : ''}`}
        style={{ color: 'var(--text-4)' }}
        onClick={onToggle}
      >
        {Icon && <Icon size={11} />}
        <span className="truncate">{label}</span>
        {pill}
        {onToggle && (
          <>
            <span className="flex-1" />
            {collapsed && count != null && count > 0 && <span>{count}</span>}
            <CollapseToggle collapsed={collapsed} onToggle={onToggle} label={toggleLabel} />
          </>
        )}
      </div>
      {!collapsed && rows.length === 0 && emptyText && (
        <div className="py-1 pl-2 pr-1" style={RAIL_EMPTY_STYLE}>
          {emptyText}
        </div>
      )}
      {!collapsed && rows}
    </div>
  );
}

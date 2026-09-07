import type { CSSProperties, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { selectedRowLabel, selectedRowStyle } from '@/presentation/components/aurora/selection';
import { RAIL_INDENT, RAIL_ROW_CLASS } from './railTokens';

export interface RailRowProps {
  icon: LucideIcon;
  iconSize?: number;
  iconStyle?: CSSProperties;
  label: string;
  active: boolean;
  /** Unselected label token (`--text-2` / `--text-3`). */
  idleColor: string;
  /** Depth in the ladder — indexes `RAIL_INDENT`. */
  level?: 0 | 1 | 2;
  /** Monospace id rows (intents). */
  mono?: boolean;
  title?: string;
  /** Trailing controls — menus, pills, chevrons; stop propagation inside. */
  trailing?: ReactNode;
  onClick: () => void;
}

/** One selectable rail row: concept icon first, label, then the trailing column. */
export function RailRow({ icon: Icon, iconSize = 14, iconStyle, label, active, idleColor, level = 0, mono, title, trailing, onClick }: RailRowProps) {
  return (
    <div
      title={title}
      className={RAIL_ROW_CLASS}
      style={{
        paddingLeft: RAIL_INDENT[level],
        ...(mono ? { fontSize: 11, fontFamily: 'var(--font-mono)' } : {}),
        ...selectedRowStyle('violet', active),
        ...selectedRowLabel(active, idleColor),
      }}
      onClick={onClick}
    >
      <Icon size={iconSize} className="shrink-0" style={iconStyle} />
      <span className="truncate flex-1">{label}</span>
      {trailing}
    </div>
  );
}

import type { LucideIcon } from 'lucide-react';
import { TOOLBAR_ICON_CLASS } from './railTokens';

/** Icon-only rail toolbar action — the label survives as title + aria-label. */
export function RailToolbarButton({ icon: Icon, label, onClick }: { icon: LucideIcon; label: string; onClick: () => void }) {
  return (
    <button type="button" title={label} aria-label={label} className={TOOLBAR_ICON_CLASS} onClick={onClick}>
      <Icon className="w-3.5 h-3.5" />
    </button>
  );
}

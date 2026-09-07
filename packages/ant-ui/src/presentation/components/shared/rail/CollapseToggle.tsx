import { ChevronDown, ChevronRight } from 'lucide-react';

/** Trailing collapse control (and the spacer that keeps chevron-less rows plumb). */
export function CollapseToggle({ collapsed, onToggle, label }: { collapsed: boolean; onToggle: () => void; label?: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      className="p-0.5 shrink-0 text-[color:var(--text-4)] hover:text-[color:var(--text-2)]"
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
    >
      {collapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
    </button>
  );
}

export const COLLAPSE_SPACER = <span className="w-4 shrink-0" />;

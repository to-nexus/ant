import { SquareCheck } from 'lucide-react';
import { ACCENT_VAR, type SectionAccent } from './SectionShell';

interface ClearSelectionButtonProps {
  accent: SectionAccent;
  ariaLabel: string;
  onClick: () => void;
}

/**
 * "Deselect the active row" affordance for the explorer lists.
 *
 * A CHECKED CHECKBOX, never an ✕. The glyph states the row's current
 * condition ("selected — press to uncheck"); an ✕ read as "delete", which in
 * FeatureRow is a real neighbouring action (inactive-row hover deletes the
 * feature — the app's only delete entry point). Keeping the two glyphs
 * disjoint is what makes either one legible, so do not reintroduce `X` here.
 *
 * Rendered only on the active row (the caller gates on `isActive`). The tint is
 * the section's rail hue (`ACCENT_VAR`, the 500 step) rather than the 600 step
 * the hover states use: the brand 600s are not redefined for dark, so there
 * they land dimmer than `--text-3` on the selected fill.
 */
export function ClearSelectionButton({ accent, ariaLabel, onClick }: ClearSelectionButtonProps) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'var(--bg-hover)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent';
      }}
      aria-label={ariaLabel}
      title="선택 해제"
      style={{
        height: 22,
        width: 22,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 6,
        color: ACCENT_VAR[accent],
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
        flexShrink: 0,
        transition: 'all var(--dur-fast)',
      }}
    >
      <SquareCheck size={14} />
    </button>
  );
}

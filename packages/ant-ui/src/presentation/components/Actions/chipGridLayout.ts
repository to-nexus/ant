/**
 * Grid geometry for the actions chip grids — the one owner of column sizing
 * for both `ActionChipGrid` and `IntentChipGrid`.
 *
 * Kept dependency-free (no store, no React component imports) so the invariant
 * below is unit-testable without booting the store.
 */

/**
 * CARD_MIN is the density floor — the narrowest a column may get before the
 * grid drops one. It is deliberately below CARD_PREF: the two serve different
 * ends, and collapsing them into one number costs a column on narrow panels.
 */
export const CARD_MIN = 184;
/** Column width the box cap aims for, so a wide panel centers rather than growing cards. */
export const CARD_PREF = 222;
export const GRID_GAP = 14;
export const MAX_COLS = 5;

/**
 * `auto-fill` (not `auto-fit`) keeps the empty tracks, so a two-card grid
 * renders card-sized cards instead of stretching them across the row.
 *
 * Invariant (pinned in `actionsLayoutTopology.test.ts`): the box cap must stay
 * under MAX_COLS+1 columns' worth of CARD_MIN, or auto-fill silently overflows
 * the column cap. Changing any constant without re-checking that breaks it.
 */
export function chipGridStyle(count: number, gap: number = GRID_GAP): React.CSSProperties {
  const cols = Math.min(Math.max(count, 1), MAX_COLS);
  return {
    display: 'grid',
    gridTemplateColumns: `repeat(auto-fill, minmax(min(100%, ${CARD_MIN}px), 1fr))`,
    gap,
    maxWidth: cols * CARD_PREF + (cols - 1) * gap,
    marginInline: 'auto',
    width: '100%',
    alignItems: 'stretch',
  };
}

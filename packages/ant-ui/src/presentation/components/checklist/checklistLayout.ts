/**
 * Checklist column layout — the ONE place the multi-column decision lives.
 *
 * The checklist is FIFO-ordered with at most one active item, so a row-major
 * grid would scatter the sequence left-to-right and destroy "what is next".
 * The board renders CSS multi-column (column-major: down, then across), and
 * this function decides how many columns that is.
 *
 * Column count is a function of BOTH the container width and the item count:
 * splitting 4 items across 3 columns breaks the ladder reading even on a wide
 * screen, so a column is only added once there are enough items to fill it.
 */

/** A column must be able to hold at least this many items before one is added. */
export const MIN_ITEMS_PER_COLUMN = 6;
export const MAX_COLUMNS = 3;

/** Container width (px) at which a second / third column becomes available. */
export const TWO_COLUMN_WIDTH = 900;
export const THREE_COLUMN_WIDTH = 1360;

/** Gap between columns, in px. */
export const COLUMN_GAP = 40;

/** Single-column reading measure — the board stays centred until it goes multi. */
export const SINGLE_COLUMN_MAX_WIDTH = 672;

export function checklistColumnCount(width: number, itemCount: number): number {
  if (!Number.isFinite(width) || itemCount <= 0) return 1;
  const byWidth = width >= THREE_COLUMN_WIDTH ? 3 : width >= TWO_COLUMN_WIDTH ? 2 : 1;
  const byCount = Math.floor(itemCount / MIN_ITEMS_PER_COLUMN);
  return Math.max(1, Math.min(byWidth, byCount, MAX_COLUMNS));
}

/**
 * BoardContainer pads its scroll body with `p-4`. A `sticky top-0` child would
 * pin at the padding edge and let rows scroll through the 16px gap above it,
 * so the summary bar offsets by this much and pads itself back.
 */
export const BOARD_BODY_PADDING = 16;

/**
 * Checklist column count — the FIFO list only goes multi-column when the
 * container is wide AND there are enough items to fill the extra column.
 * Splitting a short list across three columns destroys the ladder reading
 * even on a wide screen, so width alone must never decide.
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_COLUMNS,
  MIN_ITEMS_PER_COLUMN,
  THREE_COLUMN_WIDTH,
  TWO_COLUMN_WIDTH,
  checklistColumnCount,
} from '../../src/presentation/components/checklist/checklistLayout';

describe('checklistColumnCount', () => {
  const cases: Array<[label: string, width: number, items: number, expected: number]> = [
    ['unmeasured container falls back to one column', 0, 40, 1],
    ['narrow container stays single column however long the list', 700, 40, 1],
    ['exactly below the two-column width stays single', TWO_COLUMN_WIDTH - 1, 40, 1],
    ['wide container with a short list stays single', 1600, 4, 1],
    ['wide container just under one full second column stays single', 1600, MIN_ITEMS_PER_COLUMN * 2 - 1, 1],
    ['two-column width with enough items goes to two', TWO_COLUMN_WIDTH, MIN_ITEMS_PER_COLUMN * 2, 2],
    ['two-column width never reaches three however long the list', TWO_COLUMN_WIDTH, 100, 2],
    ['three-column width with enough items goes to three', THREE_COLUMN_WIDTH, MIN_ITEMS_PER_COLUMN * 3, 3],
    ['three-column width with only two columns of items stays at two', THREE_COLUMN_WIDTH, MIN_ITEMS_PER_COLUMN * 2, 2],
    ['a very long list is still capped', 4000, 500, MAX_COLUMNS],
    ['empty list is one column', 4000, 0, 1],
  ];

  it.each(cases)('%s', (_label, width, items, expected) => {
    expect(checklistColumnCount(width, items)).toBe(expected);
  });

  it('never returns less than one or more than the cap', () => {
    for (const width of [-100, 0, 320, 900, 1360, 5000, Number.NaN]) {
      for (const items of [0, 1, 7, 200]) {
        const n = checklistColumnCount(width, items);
        expect(n).toBeGreaterThanOrEqual(1);
        expect(n).toBeLessThanOrEqual(MAX_COLUMNS);
      }
    }
  });
});

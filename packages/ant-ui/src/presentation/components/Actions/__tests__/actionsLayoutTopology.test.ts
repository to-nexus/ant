/**
 * Layout topology guard for the actions panel (canonical + universal).
 *
 * A long intent list rendered with its first rows permanently cut off: the
 * `PageTransition` motion div carried
 * `flex-1 flex items-center justify-center p-5 overflow-y-auto`, making one
 * element both the scroll container and the vertical centerer. `align-items:
 * center` on an overflowing flex container splits the overflow above and below
 * the box, and everything above `scrollTop: 0` is unreachable.
 *
 * The fix is structural, so the guard is structural: a scroll container and a
 * cross-axis centerer must never be the same element. Asserted over class
 * strings rather than over rendered prose, so rewording a label cannot fail it.
 */

import { describe, it, expect } from 'vitest';
import { chipGridStyle, CARD_MIN, CARD_PREF, GRID_GAP, MAX_COLS } from '../chipGridLayout';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ACTIONS_DIR = join(__dirname, '..');

function collectFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      return entry === '__tests__' ? [] : collectFiles(full);
    }
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [full] : [];
  });
}

/** Quoted / backticked string literals — catches both inline className and extracted consts. */
function classStrings(source: string): string[] {
  return [...source.matchAll(/(['"`])([^'"`\n]*?)\1/g)]
    .map((m) => m[2])
    .filter((s) => /(^|\s)(flex|grid|overflow-|items-|justify-)/.test(s));
}

describe('actions panel layout topology', () => {
  const files = collectFiles(ACTIONS_DIR);

  it('finds the actions components', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it('never makes one element both the scroller and the cross-axis centerer', () => {
    const offenders: string[] = [];

    for (const file of files) {
      for (const cls of classStrings(readFileSync(file, 'utf8'))) {
        const scrolls = /\boverflow-y-auto\b|\boverflow-auto\b/.test(cls);
        const centersCrossAxis = /\bitems-center\b/.test(cls) && /\bflex\b/.test(cls) && !/\bflex-col\b/.test(cls);
        if (scrolls && centersCrossAxis) {
          offenders.push(`${relative(ACTIONS_DIR, file)} → "${cls}"`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});

describe('chip grid column cap', () => {
  /** How many auto-fill tracks of CARD_MIN actually fit in a box of `width`. */
  const tracksIn = (width: number) => Math.floor((width + GRID_GAP) / (CARD_MIN + GRID_GAP));

  it('never lets auto-fill exceed MAX_COLS at the box cap', () => {
    // The cap is a CARD_PREF-based width, but auto-fill fills it with CARD_MIN
    // tracks — so the cap must not admit an extra column.
    for (const count of [1, 2, 3, 4, 5, 8, 14, 40]) {
      const maxWidth = chipGridStyle(count).maxWidth as number;
      expect(tracksIn(maxWidth)).toBeLessThanOrEqual(MAX_COLS);
      expect(tracksIn(maxWidth)).toBe(Math.min(count, MAX_COLS));
    }
  });

  it('keeps CARD_MIN below CARD_PREF so narrow panels do not lose a column', () => {
    expect(CARD_MIN).toBeLessThan(CARD_PREF);
    // Two columns must still fit the ~384px container the old @sm gate used.
    expect(tracksIn(384)).toBeGreaterThanOrEqual(2);
  });
});

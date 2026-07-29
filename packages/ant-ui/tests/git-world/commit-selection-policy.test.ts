/**
 * Commit/discard selection policy guards.
 *
 * Root-cause regression (`fatal: pathspec ... did not match any files`): the
 * FE used to ALWAYS ship an explicit file list — frozen at modal-open — so a
 * once-untracked file deleted after the snapshot poisoned `git add`
 * atomically and the commit failed forever. Policy now:
 *   - full selection ships NO list (BE stages filesystem truth `git add '.'`)
 *   - partial selection ships a list the BE reconciles against live status
 *   - the denominator is DISTINCT paths (staged+unstaged overlap dedup)
 */
import { describe, it, expect } from 'vitest';
import {
  distinctChangedPaths,
  derivePartialSelection,
} from '../../src/presentation/components/GitStatusButton/selectionPolicy';

const fc = (path: string) => ({ path, status: 'modified' as const });

describe('distinctChangedPaths', () => {
  it('dedupes a file present in both staged and unstaged buckets', () => {
    const snapshot = {
      staged: [fc('src/a.ts')],
      unstaged: [fc('src/a.ts'), fc('src/b.ts')],
      untracked: [fc('new.ts')],
    };
    expect(distinctChangedPaths(snapshot)).toEqual(['src/a.ts', 'src/b.ts', 'new.ts']);
  });

  it('returns empty for a clean snapshot', () => {
    expect(distinctChangedPaths({ staged: [], unstaged: [], untracked: [] })).toEqual([]);
  });
});

describe('derivePartialSelection', () => {
  it('full selection → undefined (BE stages filesystem truth, stale-proof)', () => {
    expect(derivePartialSelection(['a.ts', 'b.ts'], 2)).toBeUndefined();
  });

  it('partial selection → explicit list (BE reconciles against live status)', () => {
    expect(derivePartialSelection(['a.ts'], 2)).toEqual(['a.ts']);
  });

  it('duplicate-inflated totals no longer force a fake "partial" list', () => {
    // Regression: with staged+unstaged double counting, 2 selected of
    // "3 total" (2 distinct) shipped an explicit list even though the user
    // had selected everything.
    const snapshot = {
      staged: [fc('src/a.ts')],
      unstaged: [fc('src/a.ts'), fc('src/b.ts')],
      untracked: [],
    };
    const distinct = distinctChangedPaths(snapshot);
    expect(derivePartialSelection(['src/a.ts', 'src/b.ts'], distinct.length)).toBeUndefined();
  });
});

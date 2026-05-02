import { describe, it, expect } from 'vitest';
import type { FeatureBreadcrumbLine } from '@ant/shared';
import { groupBreadcrumbs, type RenderRow } from '../groupBreadcrumbs';

/**
 * `groupBreadcrumbs` is a pure helper: feed it ascending-by-`ts` BC
 * lines and assert the flat render sequence. No DOM / RTL needed.
 */

let counter = 0;
function bc(
  partial: Partial<FeatureBreadcrumbLine> & { ts: string; turnId: string },
): FeatureBreadcrumbLine {
  counter += 1;
  return {
    type: 'breadcrumb',
    ts: partial.ts,
    jobId: partial.jobId ?? `job-${counter}`,
    turnId: partial.turnId,
    jobType: partial.jobType ?? 'code',
    scope: partial.scope ?? 'modification',
    mode: partial.mode ?? 'generate',
    summary: partial.summary ?? `summary-${counter}`,
    anchors: partial.anchors ?? {},
    stats: partial.stats ?? {},
  };
}

const NOW = new Date('2026-05-03T12:00:00Z');

function dateRows(rows: RenderRow[]) {
  return rows.filter(r => r.kind === 'date');
}

function turnRows(rows: RenderRow[]) {
  return rows.filter(r => r.kind === 'turn') as Extract<RenderRow, { kind: 'turn' }>[];
}

describe('groupBreadcrumbs', () => {
  it('returns [] for empty input (timeline empty-state branch reads this)', () => {
    expect(groupBreadcrumbs([], { now: NOW })).toEqual([]);
  });

  it('emits a single date row + single turn row for one BC', () => {
    const rows = groupBreadcrumbs(
      [bc({ ts: '2026-05-03T10:00:00Z', turnId: 't1' })],
      { now: NOW },
    );
    expect(rows.map(r => r.kind)).toEqual(['date', 'turn']);
    const turns = turnRows(rows);
    expect(turns).toHaveLength(1);
    expect(turns[0]!.items).toHaveLength(1);
    expect(turns[0]!.turnId).toBe('t1');
  });

  it('groups multiple BCs sharing the same turnId on the same day', () => {
    const rows = groupBreadcrumbs(
      [
        bc({ ts: '2026-05-03T10:00:00Z', turnId: 't1', summary: 'a' }),
        bc({ ts: '2026-05-03T10:01:00Z', turnId: 't1', summary: 'b' }),
        bc({ ts: '2026-05-03T10:02:00Z', turnId: 't1', summary: 'c' }),
      ],
      { now: NOW },
    );
    const turns = turnRows(rows);
    expect(turns).toHaveLength(1);
    expect(turns[0]!.items.map(i => i.summary)).toEqual(['a', 'b', 'c']);
    // Header ts is the first BC in the group (used by the UI for time stamping)
    expect(turns[0]!.headerTs).toBe('2026-05-03T10:00:00Z');
  });

  it('separates two turns on the same day with no extra date row in between', () => {
    const rows = groupBreadcrumbs(
      [
        bc({ ts: '2026-05-03T10:00:00Z', turnId: 't1' }),
        bc({ ts: '2026-05-03T11:00:00Z', turnId: 't2' }),
      ],
      { now: NOW },
    );
    expect(rows.map(r => r.kind)).toEqual(['date', 'turn', 'turn']);
    expect(dateRows(rows)).toHaveLength(1);
    expect(turnRows(rows).map(t => t.turnId)).toEqual(['t1', 't2']);
  });

  it('emits a new date row when the local day changes (today / yesterday)', () => {
    const rows = groupBreadcrumbs(
      [
        bc({ ts: '2026-05-02T10:00:00Z', turnId: 't1' }),
        bc({ ts: '2026-05-03T10:00:00Z', turnId: 't2' }),
      ],
      { now: NOW },
    );
    const dates = dateRows(rows);
    expect(dates.map(d => d.bucket)).toEqual(['yesterday', 'today']);
    // The structure must alternate date → turn so the renderer never has
    // two consecutive date rows.
    expect(rows.map(r => r.kind)).toEqual(['date', 'turn', 'date', 'turn']);
  });

  it('splits a single turnId across midnight into two turn rows under two date rows', () => {
    // Same turnId, two days. Use UTC times that fall on different *local*
    // days for the test runner's tz; we bracket with a wide gap to make
    // the split unambiguous regardless of tz.
    const rows = groupBreadcrumbs(
      [
        bc({ ts: '2026-05-02T08:00:00Z', turnId: 't1', summary: 'late' }),
        bc({ ts: '2026-05-03T08:00:00Z', turnId: 't1', summary: 'next-morning' }),
      ],
      { now: NOW },
    );
    expect(rows.map(r => r.kind)).toEqual(['date', 'turn', 'date', 'turn']);
    const turns = turnRows(rows);
    expect(turns).toHaveLength(2);
    expect(turns[0]!.turnId).toBe('t1');
    expect(turns[1]!.turnId).toBe('t1');
    expect(turns[0]!.dateKey).not.toBe(turns[1]!.dateKey);
    expect(turns[0]!.items.map(i => i.summary)).toEqual(['late']);
    expect(turns[1]!.items.map(i => i.summary)).toEqual(['next-morning']);
  });

  it('classifies an `older` date row when neither today nor yesterday', () => {
    const rows = groupBreadcrumbs(
      [bc({ ts: '2026-04-20T10:00:00Z', turnId: 't1' })],
      { now: NOW },
    );
    expect(dateRows(rows)[0]!.bucket).toBe('older');
  });
});

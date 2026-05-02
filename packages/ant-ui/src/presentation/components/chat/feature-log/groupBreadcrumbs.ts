import type { FeatureBreadcrumbLine } from '@ant/shared';

/**
 * Pure grouping for {@link BreadcrumbTimeline}.
 *
 * Input: ascending-by-`ts` breadcrumb lines.
 *
 * Output: a flat render sequence that the component renders top-to-bottom:
 *   - `date` rows are inline separators (`Today` / `Yesterday` / `MMM d`)
 *   - `turn` rows are mini-groups bound by `(date, turnId)` so a single
 *     user turn's BCs render under one bracket. A turn that crosses
 *     midnight is split into two `turn` groups (one per local date).
 *
 * The `mode` of a group is taken from the first BC in the group. We do
 * not synthesize a `mixed` value — within a single turn the worker
 * subgraph shares one `resolvedAction.mode` (see
 * `packages/ant-cli/src/agents/architect/graph/code/graph.ts:78`), so a
 * mixed-mode case cannot legitimately occur today. If that invariant
 * ever loosens, callers should detect it explicitly rather than have
 * this helper hide it.
 *
 * Pure / deterministic: no `Date.now`, no locale-dependent formatting
 * (the caller owns label formatting via `formatDateLabel` so tests can
 * inject a fixed `now`).
 */

export type DateBucket = 'today' | 'yesterday' | 'older';

export interface DateRow {
  kind: 'date';
  /** Local date stamp `YYYY-MM-DD` so the renderer can dedup / format. */
  dateKey: string;
  bucket: DateBucket;
}

export interface TurnRow {
  kind: 'turn';
  turnId: string;
  /** Local date this slice of the turn belongs to (`YYYY-MM-DD`). */
  dateKey: string;
  /** First BC's `ts` in this slice — used as the group header timestamp. */
  headerTs: string;
  mode?: FeatureBreadcrumbLine['mode'];
  items: FeatureBreadcrumbLine[];
}

export type RenderRow = DateRow | TurnRow;

export interface GroupOptions {
  /** Reference instant used to decide today/yesterday buckets. Defaults to `new Date()`. */
  now?: Date;
}

/**
 * Local-date stamp `YYYY-MM-DD` for the BC's `ts`. The breadcrumb's
 * `ts` is ISO-8601 in UTC; the renderer wants the user's *local* day
 * (so a UTC-late timestamp shows up under the correct local date).
 */
function localDateKey(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '0000-00-00';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function bucketFor(dateKey: string, now: Date): DateBucket {
  const todayKey = localDateKey(now.toISOString());
  if (dateKey === todayKey) return 'today';
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  const yesterdayKey = localDateKey(y.toISOString());
  if (dateKey === yesterdayKey) return 'yesterday';
  return 'older';
}

export function groupBreadcrumbs(
  items: ReadonlyArray<FeatureBreadcrumbLine>,
  opts: GroupOptions = {},
): RenderRow[] {
  if (items.length === 0) return [];
  const now = opts.now ?? new Date();

  // Defensive: callers feed already-sorted input, but a duplicated sort
  // is O(n log n) and removes a hidden ordering coupling. The render
  // sequence depends on stable ascending order.
  const sorted = [...items].sort((a, b) =>
    a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0,
  );

  const out: RenderRow[] = [];
  let lastDateKey: string | null = null;
  let currentTurn: TurnRow | null = null;

  const flushTurn = () => {
    if (currentTurn) {
      out.push(currentTurn);
      currentTurn = null;
    }
  };

  for (const bc of sorted) {
    const dateKey = localDateKey(bc.ts);

    if (dateKey !== lastDateKey) {
      flushTurn();
      out.push({ kind: 'date', dateKey, bucket: bucketFor(dateKey, now) });
      lastDateKey = dateKey;
    }

    // A turn split across midnight produces two `turn` rows because the
    // date row above us already separated them — we never want a turn
    // group to span a date boundary.
    if (
      currentTurn &&
      currentTurn.turnId === bc.turnId &&
      currentTurn.dateKey === dateKey
    ) {
      currentTurn.items.push(bc);
    } else {
      flushTurn();
      currentTurn = {
        kind: 'turn',
        turnId: bc.turnId,
        dateKey,
        headerTs: bc.ts,
        mode: bc.mode,
        items: [bc],
      };
    }
  }
  flushTurn();

  return out;
}

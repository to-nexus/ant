import type { CodeTask } from '../../../../../types/task';

/**
 * Plan-time size gate — the runtime floor that the prompt-only split
 * rubric cannot guarantee.
 *
 * Background (dim-beating-brass RCA): a `feature` aggregator task ("Route
 * Track: 학부모 화면") finalised a FLAT plan of 16–19 top-level
 * implementation entries spanning 7 feature domains. Because fan-out is
 * LLM-explicit-only (`process.ts` emits `batches[]` ⇒ split, flat ⇒ run
 * as one task), the task executed as a single unit, read-thrashed the
 * same foundation files 7× each with ZERO writes, and burned the 200-step
 * LangGraph recursion budget to a hard crash with no code produced. The
 * split rubric (`task-split-rubric.md` + plan `rules.md` "Single-session
 * closure") already TELLS the LLM to split on volume — it did not, twice.
 * Prompt-only enforcement leaks; this gate makes it enforceable.
 *
 * The gate does NOT fabricate batches (that decision was deliberately
 * removed in 05977571). It only decides WHEN to force the LLM to
 * re-partition its own flat plan — the seams stay LLM-authored.
 *
 * Trips only when ALL of the following hold (AND), so a legitimately
 * coherent large-but-uniform plan never trips:
 *   1. count    — `topLevelImplCount >= IMPL_FLOOR` (cheap floor).
 *   2. breadth  — `distinctTopLevelDomains >= DOMAIN_SPREAD`. The
 *                 discriminator: a uniform mechanical plan ("18 cards,
 *                 one token swap") concentrates in ≤2 directory buckets
 *                 and is excluded; a cross-domain aggregator is not.
 *   3. budget   — `estRoundTrips > remainingRecursionBudget *
 *                 BUDGET_FRACTION`. Grounds the gate in the SAME
 *                 `remainingRecursionBudget` the plan prompt already
 *                 surfaces (`nodes/plan/llm/prompt.ts`).
 */

/** Below this top-level implementation-entry count, read-thrash cannot
 *  plausibly reach the recursion ceiling — never trip. Env:
 *  `ANT_FLATPLAN_IMPL_FLOOR`. */
export const IMPL_FLOOR = envInt('ANT_FLATPLAN_IMPL_FLOOR', 8);

/** Minimum distinct top-level domain/directory buckets for the gate to
 *  trip. Mirrors the "≥4 distinct feature domains ⇒ split per domain"
 *  signal taught in plan `rules.md`. Env: `ANT_FLATPLAN_DOMAIN_SPREAD`. */
export const DOMAIN_SPREAD = envInt('ANT_FLATPLAN_DOMAIN_SPREAD', 4);

/** Estimated LangGraph recursion ticks consumed per implementation unit
 *  (read+search+edit+verify rounds × ~2 ticks/round). Derived from the
 *  dim-beating-brass log: 240 execute tool calls / ~19 units. Env:
 *  `ANT_FLATPLAN_EST_RT_PER_UNIT`. */
export const EST_RT_PER_UNIT = envInt('ANT_FLATPLAN_EST_RT_PER_UNIT', 6);

/** Fraction of the remaining recursion budget the estimated work may use
 *  before single-session closure is deemed unrealistic. Env:
 *  `ANT_FLATPLAN_BUDGET_FRACTION` (float). */
export const BUDGET_FRACTION = envFloat('ANT_FLATPLAN_BUDGET_FRACTION', 0.6);

/** Max forced re-partition rounds before the task soft-fails with
 *  `flatplan_too_large`. Env: `ANT_FLATPLAN_REFRAME_MAX`. */
export const MAX_FLATPLAN_REFRAME_ATTEMPTS = envInt('ANT_FLATPLAN_REFRAME_MAX', 2);

/** Task types whose flat plans are subject to the size gate. error /
 *  verification diagnostic plans carry a different (root-cause) shape and
 *  are intentionally excluded. */
export const SIZE_GATE_TYPES: ReadonlySet<CodeTask['type']> = new Set<CodeTask['type']>([
  'feature',
  'ui',
  'design-system',
]);

export interface FlatPlanGateMetrics {
  topLevelImplCount: number;
  distinctTopLevelDomains: number;
  /** Up to 8 sample domain buckets, for the reframe framing + logs. */
  domainSamples: string[];
  estRoundTrips: number;
  remainingRecursionBudget: number;
}

export type FlatPlanGateReason =
  | 'tripped'
  | 'below_floor'
  | 'concentrated'
  | 'within_budget';

export interface FlatPlanGateResult {
  trip: boolean;
  reason: FlatPlanGateReason;
  metrics: FlatPlanGateMetrics;
}

export interface FlatPlanGateInput {
  modify: any[];
  create: any[];
  delete: any[];
  recursionLimit?: number;
  recursionCount?: number;
}

/**
 * Pull a filesystem path out of a flat-plan implementation entry. Entry
 * shapes vary by emitter; probe the common path-bearing fields.
 */
function entryPath(entry: any): string {
  if (!entry || typeof entry !== 'object') return '';
  const cand = entry.target ?? entry.path ?? entry.file ?? entry.location ?? entry.filePath;
  return typeof cand === 'string' ? cand : '';
}

/**
 * Normalise a path to a coarse domain bucket = the first two DIRECTORY
 * segments (filename dropped) after stripping monorepo / source-root
 * prefixes. Examples:
 *   codebase/src/application/capsule/index.ts   → application/capsule
 *   packages/fe-main/src/presentation/auth/x.ts → presentation/auth
 *   src/domain/dashboard/model.ts               → domain/dashboard
 *   src/Btn.tsx                                 → (root)
 *
 * Bucketing by directory (not filename) keeps two files in the same
 * folder in one bucket: a uniform card-swap plan
 * (presentation/components/cards/*.tsx → presentation/components) and a
 * pile of root-level files (→ (root)) both collapse to one bucket and so
 * never trip the breadth condition. A genuinely cross-domain aggregator
 * (capsule / feed / dashboard / auth / …) yields ≥4 distinct buckets.
 * Empty path → '' (ignored).
 */
export function domainBucket(path: string): string {
  if (!path) return '';
  let p = path.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
  // Strip leading monorepo/source-root prefixes.
  p = p.replace(/^codebase\//, '');
  p = p.replace(/^(?:packages|apps)\/[^/]+\//, '');
  p = p.replace(/^src\//, '');
  const segs = p.split('/').filter(Boolean);
  // Bare file (no directory) → shared root bucket so a flat pile of
  // root-level files counts as one area, not N.
  if (segs.length <= 1) return '(root)';
  const dirs = segs.slice(0, -1); // drop the filename
  return dirs.slice(0, 2).join('/');
}

export function evaluateFlatPlanSizeGate(input: FlatPlanGateInput): FlatPlanGateResult {
  const modify = Array.isArray(input.modify) ? input.modify : [];
  const create = Array.isArray(input.create) ? input.create : [];
  const del = Array.isArray(input.delete) ? input.delete : [];
  const topLevelImplCount = modify.length + create.length + del.length;

  const buckets = new Set<string>();
  for (const e of [...modify, ...create, ...del]) {
    const b = domainBucket(entryPath(e));
    if (b) buckets.add(b);
  }
  const distinctTopLevelDomains = buckets.size;
  const domainSamples = [...buckets].slice(0, 8);

  const remainingRecursionBudget = Math.max(
    0,
    (input.recursionLimit ?? 200) - (input.recursionCount ?? 0),
  );
  const estRoundTrips = topLevelImplCount * EST_RT_PER_UNIT;

  const metrics: FlatPlanGateMetrics = {
    topLevelImplCount,
    distinctTopLevelDomains,
    domainSamples,
    estRoundTrips,
    remainingRecursionBudget,
  };

  if (topLevelImplCount < IMPL_FLOOR) {
    return { trip: false, reason: 'below_floor', metrics };
  }
  // Breadth discriminator — concentrated work (≤2 buckets) is the
  // legitimate uniform-mechanical case the rubric bundles; never trip.
  if (distinctTopLevelDomains <= 2 || distinctTopLevelDomains < DOMAIN_SPREAD) {
    return { trip: false, reason: 'concentrated', metrics };
  }
  if (estRoundTrips <= remainingRecursionBudget * BUDGET_FRACTION) {
    return { trip: false, reason: 'within_budget', metrics };
  }
  return { trip: true, reason: 'tripped', metrics };
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function envFloat(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

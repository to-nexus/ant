/**
 * Breadcrumb Construction + Trace Collection (Phase C — session redesign §12).
 *
 * `buildBreadcrumb` implements the "Bubble-up" algorithm: touched file paths
 * are abstracted into progressively coarser anchors (files → paths → specs →
 * initial_creation) based on the touched count threshold matrix in
 * `BREADCRUMB_THRESHOLDS`. Each tier is capped by `BREADCRUMB_LIMITS`.
 *
 * `collectTouchedFilesFromTrace` reads trace.jsonl for a specific turnId and
 * returns the set of file paths that were written (SSOT: trace file_write
 * events — see §2.4 / §3.2).
 *
 * Both are pure-ish helpers: `buildBreadcrumb` is pure, and
 * `collectTouchedFilesFromTrace` only reads the session port.
 */
import type {
  FeatureBreadcrumbLine,
  TraceLine,
  TraceFileWriteLine,
  LogJobType,
} from '@ant/shared';
import { BREADCRUMB_THRESHOLDS, BREADCRUMB_LIMITS } from '@ant/shared';
import type { Mode } from '@ant/shared';
import type { SessionPort } from '../ports/session';

// ═══════════════════════════════════════════════════════════════════════
// buildBreadcrumb
// ═══════════════════════════════════════════════════════════════════════

export interface BuildBreadcrumbInput {
  jobId: string;
  turnId: string;
  jobType: LogJobType;
  /** Detect mode (used to derive scope='refactor' without re-reading state). */
  mode?: Mode;
  /**
   * Distinct touched file paths (workspace-relative). Order-preserving.
   * Duplicates are ignored by the caller (Set) but this function is
   * defensive against duplicates too.
   */
  touched: string[];
  /**
   * Optional operation breakdown so stats can reflect create/modify/delete
   * counts. When omitted, `modified` is inferred as touched.length.
   */
  created?: string[];
  modified?: string[];
  deleted?: string[];
  /** Noun-form 1-line summary (see learn/rules.md FPOP constraint). */
  summary: string;
  /** Optional trace.jsonl range (startTs/endTs) for UI trace view. */
  traceRangeRef?: { startTs: string; endTs: string };
  /** Explicit timestamp override (tests). Defaults to `new Date().toISOString()`. */
  ts?: string;
}

type BreadcrumbScope = FeatureBreadcrumbLine['scope'];

/**
 * Derive the scope classification from mode + touched size.
 * - refactor mode always wins
 * - very large touched sets (> LARGE) imply an initial_creation scope
 * - otherwise the breadcrumb marks a modification
 *
 * Callers that know they are scaffolding a new feature can pre-assign
 * scope by simply passing > LARGE touched files OR we could add an
 * explicit override. Keeping this inferred avoids leaking implementation
 * choices (FPOP: Principles over Examples).
 */
function deriveScope(mode: Mode | undefined, touchedCount: number): BreadcrumbScope {
  if (mode === 'refactor') return 'refactor';
  if (touchedCount > BREADCRUMB_THRESHOLDS.LARGE) return 'initial_creation';
  return 'modification';
}

/**
 * Collapse paths into their top-level directory patterns (e.g.
 * `src/foo/bar/baz.ts` → `src/foo/**`). Used at MEDIUM/LARGE tiers.
 */
function collapseToTopLevelPaths(paths: string[], cap: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of paths) {
    const parts = p.split('/').filter(Boolean);
    const head = parts.length <= 1 ? parts[0] ?? p : `${parts[0]}/${parts[1]}/**`;
    if (seen.has(head)) continue;
    seen.add(head);
    out.push(head);
    if (out.length >= cap) break;
  }
  return out;
}

/**
 * At the LARGE tier, surface only the spec/document-looking paths and
 * the top-level directory patterns. "Spec" is observed structurally —
 * files under `docs/`, `outputs/design/`, or extension `.md`. We do not
 * hardcode project-specific conventions (FPOP: Universal over Specific).
 */
function extractSpecs(paths: string[], cap: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of paths) {
    const lower = p.toLowerCase();
    const isSpec =
      lower.endsWith('.md') ||
      lower.startsWith('docs/') ||
      lower.includes('/docs/') ||
      lower.includes('outputs/design/');
    if (!isSpec) continue;
    if (seen.has(p)) continue;
    seen.add(p);
    out.push(p);
    if (out.length >= cap) break;
  }
  return out;
}

export function buildBreadcrumb(input: BuildBreadcrumbInput): FeatureBreadcrumbLine {
  const uniqueTouched = Array.from(new Set(input.touched));
  const touchedCount = uniqueTouched.length;
  const scope = deriveScope(input.mode, touchedCount);

  const anchors: FeatureBreadcrumbLine['anchors'] = {};

  if (touchedCount > BREADCRUMB_THRESHOLDS.LARGE) {
    // initial_creation / overwhelming scope: keep only specs + paths summary
    const specs = extractSpecs(uniqueTouched, BREADCRUMB_LIMITS.specs);
    const paths = collapseToTopLevelPaths(uniqueTouched, BREADCRUMB_LIMITS.paths);
    if (specs.length > 0) anchors.specs = specs;
    if (paths.length > 0) anchors.paths = paths;
  } else if (touchedCount > BREADCRUMB_THRESHOLDS.MEDIUM) {
    // LARGE tier (51–200): specs + top-level paths
    const specs = extractSpecs(uniqueTouched, BREADCRUMB_LIMITS.specs);
    const paths = collapseToTopLevelPaths(uniqueTouched, BREADCRUMB_LIMITS.paths);
    if (specs.length > 0) anchors.specs = specs;
    if (paths.length > 0) anchors.paths = paths;
  } else if (touchedCount > BREADCRUMB_THRESHOLDS.SMALL) {
    // MEDIUM tier (11–50): collapsed paths only
    const paths = collapseToTopLevelPaths(uniqueTouched, BREADCRUMB_LIMITS.paths);
    if (paths.length > 0) anchors.paths = paths;
  } else {
    // SMALL tier (≤10): concrete files
    const files = uniqueTouched.slice(0, BREADCRUMB_LIMITS.files);
    if (files.length > 0) anchors.files = files;
  }

  const createdCount = input.created?.length;
  const modifiedCount = input.modified?.length;
  const deletedCount = input.deleted?.length;

  const stats: FeatureBreadcrumbLine['stats'] = {
    touched: touchedCount,
  };
  if (typeof createdCount === 'number') stats.created = createdCount;
  if (typeof modifiedCount === 'number') stats.modified = modifiedCount;
  if (typeof deletedCount === 'number') stats.deleted = deletedCount;

  return {
    type: 'breadcrumb',
    ts: input.ts ?? new Date().toISOString(),
    jobId: input.jobId,
    turnId: input.turnId,
    jobType: input.jobType,
    mode: input.mode,
    scope,
    anchors,
    summary: input.summary,
    stats,
    ...(input.traceRangeRef ? { traceRangeRef: input.traceRangeRef } : {}),
  };
}

// ═══════════════════════════════════════════════════════════════════════
// collectTouchedFilesFromTrace
// ═══════════════════════════════════════════════════════════════════════

export interface TouchedFromTrace {
  all: Set<string>;
  created: string[];
  modified: string[];
  deleted: string[];
  /** trace.jsonl ts range covering the first/last file_write for this turn. */
  range?: { startTs: string; endTs: string };
}

/**
 * Collect file_write events from trace.jsonl for a given turnId.
 *
 * SSOT: trace.jsonl `type: 'file_write'` lines (see shared/session-log.ts).
 * Reader-side filtering is defensive against mixed turns so the same trace
 * file can serve UI + breadcrumb collection without separate indexing.
 *
 * Returns empty sets when the session port is unavailable or the trace
 * contains no matching events.
 */
export async function collectTouchedFilesFromTrace(
  session: SessionPort | undefined,
  turnId: string | undefined,
): Promise<TouchedFromTrace> {
  const empty: TouchedFromTrace = {
    all: new Set<string>(),
    created: [],
    modified: [],
    deleted: [],
  };
  if (!session || !turnId) return empty;

  let lines: TraceLine[] = [];
  try {
    lines = await session.loadTraceByTurnIds([turnId]);
  } catch (err) {
    console.warn('⚠️  [Breadcrumb] loadTraceByTurnIds failed:', err);
    return empty;
  }

  const writes = lines.filter(
    (l): l is TraceFileWriteLine => l.type === 'file_write',
  );
  if (writes.length === 0) return empty;

  const all = new Set<string>();
  const created: string[] = [];
  const modified: string[] = [];
  const deleted: string[] = [];

  for (const w of writes) {
    if (!w.path) continue;
    all.add(w.path);
    switch (w.operation) {
      case 'create':
        created.push(w.path);
        break;
      case 'delete':
        deleted.push(w.path);
        break;
      case 'update':
      default:
        modified.push(w.path);
        break;
    }
  }

  const range = {
    startTs: writes[0].ts,
    endTs: writes[writes.length - 1].ts,
  };

  return { all, created, modified, deleted, range };
}

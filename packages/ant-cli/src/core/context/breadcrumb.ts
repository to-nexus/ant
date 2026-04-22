/**
 * Breadcrumb Construction + Chat Log Collection (Phase C — session redesign §12).
 *
 * `buildBreadcrumb` implements the "Bubble-up" algorithm: touched file paths
 * are abstracted into progressively coarser anchors (files → paths → specs →
 * initial_creation) based on the touched count threshold matrix in
 * `BREADCRUMB_THRESHOLDS`. Each tier is capped by `BREADCRUMB_LIMITS`.
 *
 * `collectTouchedFilesFromChatLog` reads chat.jsonl for a specific turnId
 * and returns the set of file paths that were written (SSOT:
 * `chat_status` lines with file-op `statusType`).
 *
 * Both are pure-ish helpers: `buildBreadcrumb` is pure, and
 * `collectTouchedFilesFromChatLog` only reads the session port.
 */
import type {
  FeatureBreadcrumbLine,
  ChatLine,
  ChatStatusLine,
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
  /** Optional chat.jsonl range (startTs/endTs) for UI activity view. */
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

/**
 * Produce a noun-form, ≤80-char one-line summary from the owning directive
 * + observed scale. Kept side-effect-free so tier strategies can reuse it.
 *
 * Scope note: this is an intentionally modest heuristic — when an LLM-driven
 * summariser replaces it the rules promoted to a template will be wired
 * through `promptBuilder`, see 18-session-redesign §12.
 */
export function buildBreadcrumbSummary(input: {
  directive: string;
  touchedCount: number;
  mode?: string;
}): string {
  const directive = (input.directive || '').trim();
  const firstLine = directive.split(/\r?\n/)[0] ?? '';
  const trimmed = firstLine.length > 80 ? `${firstLine.slice(0, 77)}…` : firstLine;
  const scale = input.touchedCount > 0 ? ` · ${input.touchedCount} files` : '';
  const modeTag = input.mode ? ` · ${input.mode}` : '';
  const core = trimmed.length > 0 ? trimmed : 'code change';
  return `${core}${modeTag}${scale}`;
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
// collectTouchedFilesFromChatLog
// ═══════════════════════════════════════════════════════════════════════

export interface TouchedFromChatLog {
  all: Set<string>;
  created: string[];
  modified: string[];
  deleted: string[];
  /** chat.jsonl ts range covering the first/last file-op line for this turn. */
  range?: { startTs: string; endTs: string };
}

/**
 * Operation implied by each file-op `chat_status.statusType`. `_failed`
 * variants still count as attempted writes on the corresponding operation
 * so the breadcrumb reflects the LLM's intent, not just successes.
 */
const FILE_OP_BY_STATUS_TYPE: Record<string, 'create' | 'update' | 'delete'> = {
  file_create: 'create',
  file_create_failed: 'create',
  file_edit: 'update',
  file_edit_failed: 'update',
  file_delete: 'delete',
  file_delete_failed: 'delete',
};

/**
 * Collect file-mutation events from chat.jsonl for a given turnId.
 *
 * SSOT: `chat_status` lines whose `statusType` is one of
 * `file_create` / `file_edit` / `file_delete` (plus `*_failed` variants)
 * and whose `metadata.filePath` is populated. Reader-side filtering is
 * defensive against mixed turns so the same chat log file can serve UI +
 * breadcrumb collection without a separate index.
 *
 * Returns empty sets when the session port is unavailable or the chat
 * log contains no matching events.
 */
export async function collectTouchedFilesFromChatLog(
  session: SessionPort | undefined,
  turnId: string | undefined,
): Promise<TouchedFromChatLog> {
  const empty: TouchedFromChatLog = {
    all: new Set<string>(),
    created: [],
    modified: [],
    deleted: [],
  };
  if (!session || !turnId) return empty;

  let lines: ChatLine[] = [];
  try {
    lines = await session.loadChatByTurnIds([turnId]);
  } catch (err) {
    console.warn('⚠️  [Breadcrumb] loadChatByTurnIds failed:', err);
    return empty;
  }

  const writes = lines
    .filter((l): l is ChatStatusLine => l.type === 'chat_status')
    .filter((l) => l.statusType in FILE_OP_BY_STATUS_TYPE);
  if (writes.length === 0) return empty;

  const all = new Set<string>();
  const created: string[] = [];
  const modified: string[] = [];
  const deleted: string[] = [];

  for (const w of writes) {
    const filePath = typeof w.metadata?.filePath === 'string' ? w.metadata.filePath : '';
    if (!filePath) continue;
    all.add(filePath);
    const op = FILE_OP_BY_STATUS_TYPE[w.statusType];
    switch (op) {
      case 'create':
        created.push(filePath);
        break;
      case 'delete':
        deleted.push(filePath);
        break;
      case 'update':
      default:
        modified.push(filePath);
        break;
    }
  }

  const range = {
    startTs: writes[0].ts,
    endTs: writes[writes.length - 1].ts,
  };

  return { all, created, modified, deleted, range };
}

/**
 * Universal run-record I/O — the single owner of per-run history inside
 * universal container session files.
 *
 * Universal sessions are keyed per (agentId, customJobId) at
 * `{container}/sessions/{agentId}/{customJobId}.json` and owned by the
 * runner (conversation memory). Run history rides the same file's `runs[]`
 * (already part of the Session schema), keyed by the per-run BullMQ jobId —
 * finalize appends via `appendRunToSessionFile`, the helpers below read and
 * locate. Deletion policy is shared with the canonical plane — see
 * `core/session/runRemoval.ts`; this module only resolves WHICH file holds a
 * given run.
 */

import * as path from 'path';
import { selectSealedConversation } from '../../../../../core/customAgents/universalConversation';
import type { KanbanData } from '@ant/shared';
import type { KanbanService } from '../../services';
import type { SessionRun } from '../../../../../core/types/session';
import { sessionWriteGuardOf, type SessionWriteGuard } from '../../../../../core/session/stateBudget';
import { removeRunFromSessionFile } from '../../../../../core/session/runRemoval';
import { readSessionTextContained } from '../../../../../core/utils/sessionPaths';
import { readBoundedEntries, type TraversalBudget } from '../../../../../core/customAgents/universalContainer';
import { logger } from '../../../../../utils/logger';

export interface UniversalSessionFileRef {
  path: string;
  agentId: string;
  customJobId: string;
}

/**
 * Enumerate `{container}/sessions/{agentDir}/*.json`. Root-level files
 * (chat.jsonl / feature.jsonl) and dotfiles are skipped by construction —
 * only one directory level below `sessions/` is scanned.
 */
export const UNIVERSAL_SESSION_SCAN_MAX_ENTRIES = 5000;

export async function listUniversalSessionFiles(containerPath: string): Promise<UniversalSessionFileRef[]> {
  const sessionsDir = path.join(containerPath, 'sessions');
  // Budget-charged enumeration (shared with the universal artifact tree): a raw
  // `readdir` materialises and sorts the WHOLE directory before any cap applies,
  // and every ref found here is then whole-file read + parsed by the callers
  // below — so bounding the walk bounds the parse fan-out too (M-NEW-029).
  const budget: TraversalBudget = { remaining: UNIVERSAL_SESSION_SCAN_MAX_ENTRIES };
  const agentDirs = readBoundedEntries(sessionsDir, budget);
  const refs: UniversalSessionFileRef[] = [];
  for (const agentDir of agentDirs) {
    if (!agentDir.isDirectory) continue;
    for (const file of readBoundedEntries(path.join(sessionsDir, agentDir.name), budget)) {
      if (!file.isFile || !file.name.endsWith('.json')) continue;
      refs.push({
        path: path.join(sessionsDir, agentDir.name, file.name),
        agentId: agentDir.name,
        customJobId: file.name.slice(0, -'.json'.length),
      });
    }
  }
  if (budget.remaining <= 0) {
    logger.warn(
      `[UniversalRuns] Session scan hit the entry budget; serving a partial view`,
      { component: 'UniversalRuns' },
      { containerPath, budget: UNIVERSAL_SESSION_SCAN_MAX_ENTRIES, refs: refs.length },
    );
  }
  return refs;
}

/**
 * Best-effort session read for the run helpers. Goes through the shared
 * bounded + contained seam: a raw whole-file `readFile` here put an
 * attacker-growable number of bytes into the API/worker heap on every history
 * call, kanban restore, delete and terminal cleanup (M-NEW-029).
 *
 * Keeps the historical `null` contract for missing/unreadable, but an
 * over-budget file is LOGGED rather than swallowed — a silent null here would
 * make `deleteUniversalRunFromSession` quietly skip the delete.
 */
async function readSessionJson(filePath: string): Promise<any | null> {
  return (await readSessionJsonGuarded(filePath))?.session ?? null;
}

/** As {@link readSessionJson}, plus the guard a read-modify-write CASes on. */
async function readSessionJsonGuarded(
  filePath: string,
): Promise<{ session: any; guard: SessionWriteGuard } | null> {
  try {
    const text = await readSessionTextContained(filePath);
    if (text === null) return null;
    return { session: JSON.parse(text), guard: sessionWriteGuardOf(text) };
  } catch (err) {
    logger.warn(
      `[UniversalRuns] Session read refused or unparseable; skipping`,
      { component: 'UniversalRuns' },
      { filePath, error: err instanceof Error ? err.message : String(err) },
    );
    return null;
  }
}

/** A run row qualifies as universal history: universal-stamped and jobId-keyed. */
function isUniversalRun(run: any, session: any): boolean {
  if (!run || typeof run.jobId !== 'string' || run.jobId.length === 0) return false;
  // Filter guards against legacy canonical-skeleton pollution inside the
  // container's sessions/ (pre-reconcile residue) leaking bogus rows.
  return run.job === 'universal' || typeof session?.state?.customJobRef === 'string';
}

/**
 * Cumulative budget for ONE history aggregation.
 *
 * The entry budget above bounds how many session FILES are enumerated. Nothing
 * bounded what they cost together: each file may be up to `SESSION_MAX_BYTES`
 * and hold unboundedly many `runs[]`, every one of which was spread-copied —
 * `kanbanSnapshot` (a whole board) included — into an array the route then
 * copied again into a Map, sorted, and stringified. Per-file caps × 5,000 files
 * is not a bound on a request (M-NEW-029).
 *
 * Two axes, because either alone is escapable: many small sessions with many
 * runs each, or few sessions that are individually huge.
 */
export const UNIVERSAL_RUN_COLLECT_MAX_RUNS = 2000;
export const UNIVERSAL_RUN_COLLECT_MAX_BYTES = 64 * 1024 * 1024;

/**
 * Flattened universal runs across all session files in the container, each
 * tagged with its `{agentId}/{customJobId}` ref (run-level `customJobRef`
 * wins when present — finalize stamps it).
 *
 * `truncated` is the caller's obligation to surface: a partial history that
 * says nothing reads as a complete one.
 */
export async function collectUniversalRuns(
  containerPath: string,
): Promise<{ runs: Array<SessionRun & { customJobRef: string }>; truncated: boolean }> {
  const out: Array<SessionRun & { customJobRef: string }> = [];
  let parsedBytes = 0;
  let truncated = false;

  for (const ref of await listUniversalSessionFiles(containerPath)) {
    if (parsedBytes >= UNIVERSAL_RUN_COLLECT_MAX_BYTES) { truncated = true; break; }
    const read = await readSessionJsonGuarded(ref.path);
    if (!read) continue;
    // Charge what was actually read back, not an assumed per-file cost.
    parsedBytes += read.guard.size > 0 ? read.guard.size : 0;
    const session = read.session;
    if (!Array.isArray(session.runs)) continue;
    for (const run of session.runs) {
      if (!isUniversalRun(run, session)) continue;
      if (out.length >= UNIVERSAL_RUN_COLLECT_MAX_RUNS) { truncated = true; break; }
      out.push({ ...run, customJobRef: run.customJobRef ?? `${ref.agentId}/${ref.customJobId}` });
    }
    if (truncated) break;
  }

  if (truncated) {
    logger.warn(
      `[UniversalRuns] Run aggregation hit its budget; serving a partial history`,
      { component: 'UniversalRuns' },
      { containerPath, runs: out.length, parsedBytes },
    );
  }
  return { runs: out, truncated };
}

/**
 * Locate the session file that references this per-run jobId — via a
 * `runs[]` entry or the sealed `state.jobId` (respond seals the run's HTTP
 * jobId). Used by finalize's mapping-less fallback, per-jobId kanban
 * restore, and DELETE.
 */
export async function findUniversalSessionFileByJobId(
  containerPath: string,
  jobId: string,
): Promise<UniversalSessionFileRef | null> {
  for (const ref of await listUniversalSessionFiles(containerPath)) {
    const session = await readSessionJson(ref.path);
    if (!session) continue;
    if (session.state?.jobId === jobId) return ref;
    if (Array.isArray(session.runs) && session.runs.some((r: any) => r?.jobId === jobId)) return ref;
  }
  return null;
}

/**
 * Board fields derivable from the sealed universal session `state` at the end
 * of a run — the checklist and this run's token usage.
 *
 * The finalize-time board is a synthesized empty non-task board (KanbanService
 * is universal-unaware), so without this overlay every persisted run snapshot
 * is blank: a past run replays as "no checklist" and the dropdown row shows no
 * token badge. `respond`'s seal already wrote both into `state`, and each turn
 * overwrites them, so at finalize they belong to THIS run.
 *
 * `jobTiming` is deliberately absent — universal seals no timing.
 * Best-effort: a missing / malformed file yields `{}`.
 */
export async function readUniversalRunOverlay(sessionPath: string): Promise<Partial<KanbanData>> {
  const session = await readSessionJson(sessionPath);
  const state = session?.state;
  if (!state) return {};
  const overlay: Partial<KanbanData> = {};
  // Same presence bar as the runner's restore (runner.ts): a checklist with no
  // items is not a checklist.
  if (Array.isArray(state.checklist?.items) && state.checklist.items.length > 0) {
    overlay.checklist = state.checklist;
  }
  if (state.tokenUsage) overlay.tokenUsage = state.tokenUsage;
  if (state.tokenUsageByModel) overlay.tokenUsageByModel = state.tokenUsageByModel;
  return overlay;
}

/**
 * Run-record fields derivable from the sealed universal session `state` at
 * finalize — the audit trail the run record was missing (blazing-crushing-
 * dream: the only evidence a stop-hook gate ran was a transient chat line,
 * and `runs[].input.summary` was hardcoded empty).
 *
 * `hookReport` is a record, never a gate input — the gate feeds on the
 * sealed `hookLedger` only. `input` is derived from the sealed main
 * conversation's first user message, clipped to the schema's 200-char cap.
 * Best-effort: a missing / malformed file yields `{}`.
 */
export async function readUniversalRunExtras(sessionPath: string): Promise<Partial<SessionRun>> {
  const session = await readSessionJson(sessionPath);
  const state = session?.state;
  if (!state) return {};
  const extras: Partial<SessionRun> = {};
  if (Array.isArray(state.lastTurnHooks) && state.lastTurnHooks.length > 0) {
    // A clarify-paused seal ended the turn under the gate's clarify
    // exemption — stamp it, or an auditor reads `met: false` on a completed
    // run as an unmet contract (oak-dreaming-sable Round 1, R1-N6).
    extras.hookReport =
      state.awaitingClarify === true
        ? state.lastTurnHooks.map((h: Record<string, unknown>) => ({ ...h, exempt: 'clarify' }))
        : state.lastTurnHooks;
  }
  const firstUser = selectSealedConversation<any>(state).find(
    (m: any) => m?.role === 'user' && typeof m.content === 'string',
  );
  if (typeof firstUser?.content === 'string' && firstUser.content.trim().length > 0) {
    extras.input = { type: 'text', summary: firstUser.content.trim().slice(0, 200) };
  }
  return extras;
}

/**
 * Remove one run's footprint from its universal session file — the universal
 * counterpart of `deleteJobRunFromSession`, and its twin only in path
 * resolution: universal sessions are keyed per (agentId, customJobId), so the
 * file has to be FOUND rather than computed.
 *
 * The removal policy itself is shared (`removeRunFromSessionFile`): the run's
 * `runs[]` entry goes, a `state` pinned to it keeps only the keys the (agent,
 * job) THREAD owns — `conversations` / `conversationChannel` / `customJobRef` —
 * and a file no run references any more is unlinked. Nulling `state.jobId`
 * alone left the deleted run's checklist, token usage and pause markers behind
 * while the board broadcast showed them gone.
 *
 * No archive sweep here: `findArchivedState` walks `SESSION_SEARCH_MAP`, which
 * carries no universal row, and `archiveSupersededState` is only ever called by
 * architect code/design — a universal archive cannot exist.
 */
export async function deleteUniversalRunFromSession(
  kanbanService: KanbanService | undefined,
  containerPath: string,
  jobId: string,
): Promise<void> {
  const ref = await findUniversalSessionFileByJobId(containerPath, jobId);
  if (!ref) return;
  await removeRunFromSessionFile(ref.path, jobId, 'universal');
  kanbanService?.invalidateSessionCache(ref.path);
}

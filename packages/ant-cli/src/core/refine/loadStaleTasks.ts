/**
 * loadStaleTasks — read chat.jsonl tail to discover design tasks the
 * most recent rev-plan run flagged as stale.
 *
 * F3.5 hooks the design runner so it can surface a console summary
 * when entering a design job after a `rev-plan` impact alert was
 * emitted. The chat-status `refine_impact` card is the SSOT — this
 * helper is read-only and tolerant of missing files.
 */

import type { ChatLine, ChatStatusLine, RefineImpactMetadata } from '@ant/shared';
import { getChatJsonlPath, readJsonlTailBounded } from '../utils/sessionPaths';

/**
 * Aggregate of stale-task signals collected from the chat log. The
 * design runner uses this to log a one-line summary at startup; the
 * raw arrays are also available for richer downstream wiring (e.g. an
 * upcoming auto-rerun mode).
 */
export interface StaleTaskSummary {
  /** Latest `refine_impact` metadata per `updatedDoc`. */
  byDoc: Record<string, RefineImpactMetadata>;
  /** Union of `affected[].taskId` across all surfaced docs. */
  affectedTaskIds: string[];
  /** Union of `unscannableTaskIds` across all surfaced docs. */
  unscannableTaskIds: string[];
}

/**
 * The bounded-window JSONL read has one owner (`readJsonlTailBounded`); this
 * helper only parses what it hands back. Malformed lines are skipped —
 * chat.jsonl is append-only, but one corrupt line must not swallow the signal.
 */
async function readChatLines(featurePath: string): Promise<ChatLine[]> {
  const window = await readJsonlTailBounded(getChatJsonlPath(featurePath));
  if (!window) return [];
  const out: ChatLine[] = [];
  for (const line of window.lines) {
    try {
      out.push(JSON.parse(line) as ChatLine);
    } catch {
      // skip
    }
  }
  return out;
}

function isRefineImpactStatus(line: ChatLine): line is ChatStatusLine {
  return (
    line.type === 'chat_status' &&
    (line as ChatStatusLine).statusType === 'refine_impact'
  );
}

/**
 * Walk the chat-log tail and aggregate the latest `refine_impact`
 * metadata for each `updatedDoc`. Older entries are overwritten so
 * the summary reflects the most recent signal per document.
 */
export async function loadStaleTasks(
  featurePath: string,
): Promise<StaleTaskSummary> {
  const lines = await readChatLines(featurePath);

  const byDoc: Record<string, RefineImpactMetadata> = {};
  for (const line of lines) {
    if (!isRefineImpactStatus(line)) continue;
    const meta = (line.metadata ?? {}) as Partial<RefineImpactMetadata>;
    if (!meta.updatedDoc) continue;
    byDoc[meta.updatedDoc] = meta as RefineImpactMetadata;
  }

  const affected = new Set<string>();
  const unscannable = new Set<string>();
  for (const meta of Object.values(byDoc)) {
    for (const a of meta.affected ?? []) affected.add(a.taskId);
    for (const id of meta.unscannableTaskIds ?? []) unscannable.add(id);
  }

  return {
    byDoc,
    affectedTaskIds: [...affected].sort(),
    unscannableTaskIds: [...unscannable].sort(),
  };
}

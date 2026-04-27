/**
 * loadStaleTasks — read chat.jsonl tail to discover design tasks the
 * most recent rev-plan run flagged as stale.
 *
 * F3.5 hooks the design runner so it can surface a console summary
 * when entering a design job after a `rev-plan` impact alert was
 * emitted. The chat-status `refine_impact` card is the SSOT — this
 * helper is read-only and tolerant of missing files.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { ChatLine, ChatStatusLine, RefineImpactMetadata } from '@ant/shared';

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

const CHAT_JSONL_TAIL_BYTES = 256 * 1024; // ~256KB tail is plenty for a session's worth of cards.

function chatJsonlPath(featurePath: string): string {
  return path.join(featurePath, 'sessions', 'chat.jsonl');
}

/**
 * Read the last N bytes of `chat.jsonl`. Drops any partial first line
 * caused by the byte-window cut so the parser only sees complete JSON
 * objects.
 */
async function readChatJsonlTail(filePath: string): Promise<string> {
  const handle = await fs.open(filePath, 'r').catch(() => null);
  if (!handle) return '';
  try {
    const stat = await handle.stat();
    const start = Math.max(0, stat.size - CHAT_JSONL_TAIL_BYTES);
    const length = stat.size - start;
    const buf = Buffer.alloc(length);
    await handle.read(buf, 0, length, start);
    const text = buf.toString('utf-8');
    if (start === 0) return text;
    const newlineIdx = text.indexOf('\n');
    return newlineIdx >= 0 ? text.slice(newlineIdx + 1) : '';
  } finally {
    await handle.close();
  }
}

function parseChatLines(jsonlText: string): ChatLine[] {
  if (!jsonlText) return [];
  const lines = jsonlText.split('\n');
  const out: ChatLine[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as ChatLine);
    } catch {
      // Skip malformed line — chat.jsonl is append-only but we don't
      // want a single corrupt line to swallow the whole signal.
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
  const jsonlText = await readChatJsonlTail(chatJsonlPath(featurePath));
  const lines = parseChatLines(jsonlText);

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

/**
 * Drain — delivery of settled subagent reports into the parent conversation.
 *
 * The `[SUBAGENT REPORT <id>]` marker written here is the durable pairing
 * protocol: a launch-ack (`Subagent launched (id: <id>)`) in history with no
 * later marker AND no live registry entry is an orphan (job died mid-child),
 * which drain converts into an explicit LOST notification. The injected LOST
 * marker itself satisfies the pairing on subsequent scans (self-idempotent).
 */

import type { MessageContentBlock } from '../../../core/ports/llm';
import type { SubagentEntry } from './types';
import { knownIds } from './registry';

export const LAUNCH_ACK_RE = /Subagent launched \(id: ([A-Za-z0-9_-]{4,})\)/g;
export const reportMarker = (id: string): string => `[SUBAGENT REPORT ${id}]`;

export function buildLaunchAck(id: string, goal: string): string {
  // NOTE: must NOT contain the literal `[SUBAGENT REPORT <id>]` pairing marker
  // — detectOrphanedLaunches scans history for that marker to decide whether a
  // launch was answered, and the ack itself would satisfy the pairing.
  return (
    `Subagent launched (id: ${id}).\n` +
    `Goal: "${goal}"\n` +
    `It is exploring in the background. Its findings will be injected into this ` +
    `conversation later as a "SUBAGENT REPORT" message tagged with this id — you ` +
    `do not need to wait or poll. Continue your own work now; if you finish ` +
    `before the report arrives, it will be delivered to you before this phase concludes.`
  );
}

export function buildReportBlocks(entries: SubagentEntry[]): MessageContentBlock[] {
  return entries.map((e) => {
    const r = e.result;
    const body = r?.report ?? 'Exploration produced no report.';
    // Partiality guidance — the `[partial]` body prefix alone gives the parent
    // no interpretation contract. (Plain prose; must NOT contain the literal
    // report marker — see the pairing invariant in this file's header.)
    const partialNote =
      r?.state === 'partial'
        ? '\n[note] This exploration was cut short by its round/time budget — treat the findings as non-exhaustive; absence of a finding is NOT evidence of absence.'
        : '';
    return {
      type: 'text',
      text: `${reportMarker(e.id)} (goal: ${e.goal})\n${body}${partialNote}`,
    } as MessageContentBlock;
  });
}

function collectText(content: unknown): string[] {
  if (typeof content === 'string') return [content];
  if (!Array.isArray(content)) return [];
  const out: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    const b = block as Record<string, unknown>;
    if (typeof b.text === 'string') out.push(b.text);
    // tool_result content can itself be a string or nested blocks
    if (b.type === 'tool_result') out.push(...collectText(b.content));
  }
  return out;
}

/**
 * Scan a conversation history for orphaned launch acks (resume after crash /
 * interruption: registry died with the process, so the report can never
 * arrive). Returns LOST notification blocks for each orphan.
 */
export function detectOrphanedLaunches(
  history: Array<{ role: string; content: unknown }> | undefined,
  ownerKey: string,
): MessageContentBlock[] {
  if (!history || history.length === 0) return [];
  const acks = new Set<string>();
  const reported = new Set<string>();
  for (const msg of history) {
    for (const text of collectText(msg.content)) {
      for (const m of text.matchAll(LAUNCH_ACK_RE)) acks.add(m[1]);
      for (const m of text.matchAll(/\[SUBAGENT REPORT ([A-Za-z0-9_-]{4,})/g)) reported.add(m[1]);
    }
  }
  const live = knownIds(ownerKey);
  const blocks: MessageContentBlock[] = [];
  for (const id of acks) {
    if (reported.has(id) || live.has(id)) continue;
    blocks.push({
      type: 'text',
      text:
        `${reportMarker(id)} — LOST\n` +
        `The job was interrupted before this subagent finished. No findings were ` +
        `recorded. Re-issue explore if the information is still needed (exploration ` +
        `is read-only and cheap to repeat).`,
    } as MessageContentBlock);
  }
  return blocks;
}

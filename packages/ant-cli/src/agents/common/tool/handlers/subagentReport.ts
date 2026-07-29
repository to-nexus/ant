/**
 * subagent_report — drill down into a compacted explore report.
 *
 * Decompaction counterpart of the inline compaction in
 * agents/common/subagent/compactReport.ts: when a report's inline form noted
 * omitted content, the full text sits in the process-local report store and
 * this handler serves offset-addressed slices of it. Ctx-free by design —
 * the store is not a workspace artifact, so no RAC/file gating applies.
 *
 * Response text must NOT contain the literal `[SUBAGENT REPORT` or
 * `Subagent launched (id:` — drain.ts orphan detection regex-scans history.
 */

import { readFullReport } from '../../subagent/reportStore';
import type { ToolHandler } from '../types';

export const handleSubagentReport: ToolHandler = async (_ctx, args) => {
  const id = typeof args.id === 'string' ? args.id.trim() : '';
  if (!id) {
    return { content: 'Error: subagent_report requires the id from the report omission notice.', error: 'missing id' };
  }
  const offset = typeof args.offset === 'number' && Number.isFinite(args.offset) ? Math.floor(args.offset) : 0;
  const maxChars = typeof args.maxChars === 'number' && Number.isFinite(args.maxChars) && args.maxChars > 0
    ? Math.floor(args.maxChars)
    : undefined;

  const slice = readFullReport(id, offset, maxChars);
  if (!slice) {
    // Do NOT assert a cause: a miss can mean the exploration hasn't finished
    // yet (its report is delivered into this conversation when it settles),
    // the id is wrong, the store rotated it out (bounded FIFO), or the
    // process restarted. The old wording claimed "the inline report was
    // already complete" as fact, which misled the parent when the report had
    // in fact never been delivered (sage-causing-rover).
    return {
      content:
        `No stored report for id '${id}'. If that exploration is still running, its report ` +
        `will be delivered into this conversation when it completes — you do not need to poll. ` +
        `Otherwise the id may be wrong, or the report has been rotated out / lost to a process ` +
        `restart; re-issue explore if the details are still needed (exploration is read-only ` +
        `and cheap to repeat).`,
    };
  }
  const end = Math.min(slice.offset + slice.slice.length, slice.total);
  const more = end < slice.total ? ` More remains — continue from offset ${end}.` : ' End of report.';
  return {
    content:
      `Full report for subagent ${id} (goal: ${slice.goal}) — chars ${slice.offset}-${end} of ${slice.total}.${more}\n\n` +
      slice.slice,
  };
};

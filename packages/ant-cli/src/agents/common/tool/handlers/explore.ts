/**
 * explore — launch an async, read-only explore subagent.
 *
 * Ctx-dependent (like read_state): requires the job to have attached a
 * `SubagentSeam` on `ctx.subagent`. The handler returns the launch ack
 * IMMEDIATELY — the child runs concurrently and its report is delivered
 * later by the drain/join seams, never through this tool result.
 *
 * `ctx.subagent` absent covers two cases with one graceful error: a child
 * context (depth-1 enforcement, layer 2 — layer 1 is the child tool list
 * never containing `explore`) and a job that exposes the tool without
 * wiring the seam.
 */

import type { ToolHandler } from '../types';

export const handleExplore: ToolHandler = async (ctx, args) => {
  const seam = ctx.subagent;
  if (!seam) {
    return {
      content: 'Error: explore is not available in this context. Do the investigation directly with read/list/search tools.',
      error: 'subagent seam not wired',
    };
  }
  const callId = ctx.currentToolCallId;
  if (!callId) {
    return {
      content: 'Error: explore launch failed (missing call id). Do the investigation directly.',
      error: 'currentToolCallId not set by orchestrator',
    };
  }
  const goal = typeof args.goal === 'string' ? args.goal.trim() : '';
  const hints = Array.isArray(args.hints)
    ? (args.hints as unknown[]).filter((h): h is string => typeof h === 'string')
    : undefined;

  const outcome = await seam.launch(callId, goal, hints);
  if ('denied' in outcome) {
    return { content: outcome.denied, error: 'launch denied' };
  }
  return { content: outcome.ack };
};

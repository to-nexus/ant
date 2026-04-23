/**
 * Merge-inject user-content builder.
 *
 * When cross-worker file conflicts force a merge-inject and the LLM has
 * also emitted `tool_use` blocks in the same turn, the user message that
 * follows MUST begin with a `tool_result` block for every `tool_use_id`
 * (Anthropic API contract). Otherwise the next LLM call fails with
 *   400 invalid_request_error — tool_use ids were found without tool_result
 *   blocks immediately after: toolu_...
 * which classifies as deterministic in TaskOrchestrator and drains the job.
 *
 * Merge injection supersedes pending tool calls by design: the merge
 * instruction inlines both the CURRENT and INTENDED contents and
 * explicitly forbids `read_file`. Synthetic `tool_result` blocks close
 * the pairing honestly; the caller then clears `llmResponse.toolCalls` so
 * the router bypasses the `tool` node on the next hop.
 *
 * Regression: job `ivory-fanning-knoll` (2026-04-24). Mirror of the
 * `bitter-looping-nurse` (2026-04-22) invariant one scope up.
 */

import type { TextContentBlock, ToolResultContentBlock } from '../../../../../../core/ports/llm';

/** Neutral supersede marker — avoids `isErrorContent` keywords (`error` / `failed` / `exception`). */
export const MERGE_SUPERSEDE_CONTENT =
  'Superseded by file-merge directive. Do not re-issue this tool call; the merge instruction that follows contains both the current and intended file contents inline.';

export interface MergeToolCall {
  id: string;
  name: string;
}

/**
 * Build the `user` message content for the merge-inject path.
 *
 * - No pending tool_use  → plain string (Anthropic API shorthand).
 * - With pending tool_use → array starting with one `tool_result` block
 *   per `tool_use_id` followed by a single `text` block carrying the
 *   merge instruction.
 */
export function buildMergeUserContent(
  toolCalls: readonly MergeToolCall[],
  mergeInstruction: string,
): string | (ToolResultContentBlock | TextContentBlock)[] {
  if (toolCalls.length === 0) {
    return mergeInstruction;
  }
  return [
    ...toolCalls.map<ToolResultContentBlock>(tc => ({
      type: 'tool_result',
      tool_use_id: tc.id,
      tool_name: tc.name,
      content: MERGE_SUPERSEDE_CONTENT,
    })),
    { type: 'text', text: mergeInstruction },
  ];
}

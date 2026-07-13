/**
 * Duplicate-read elision + already-read manifest — tool-node consumers of
 * `core/context/duplicateReads`.
 *
 * Both operate on the HISTORY side only (the tool_result user turn about to
 * be appended). Execution events are left untouched, so debug logs keep the
 * real execution record (dup-read REQUEST counts stay observable for the
 * effectiveness gate); elision hits are logged separately by createToolNode.
 *
 * Cache-safety note (why this lives at history-append time, not per-round
 * wire injection): the Anthropic adapter caches the longest prefix ending at
 * a rolling tail marker. Anything injected only into the wire copy of a round
 * would never reappear in the next round's prefix, invalidating every cached
 * span and re-creating the prime-nesting-grate caching regression. Content
 * appended HERE is persisted into history, so prefixes stay byte-stable.
 */

import type { ToolCall } from './types';
import type { ToolResultContentBlock, TextContentBlock, MessageContentBlock } from '../../../core/ports/llm';
import type { ConversationMessage } from '../../../core/context';
import {
  extractLatestReadContent,
  preservedReadKeyOf,
  stringifyToolResultContent,
  buildDuplicateReadStub,
  buildAlreadyReadManifest,
  readRangeOf,
} from '../../../core/context';
import { CACHED_RESULT_PREFIX } from './orchestrator';
import { ToolName } from './toolCatalog';

/** Strip the orchestrator cache-hit prefix so cached re-reads compare equal. */
function normalizeReadContent(text: string): string {
  return text.startsWith(CACHED_RESULT_PREFIX) ? text.slice(CACHED_RESULT_PREFIX.length) : text;
}

/**
 * Execute-then-compare elision: for each successful read_file result whose
 * content is identical to the preserved prior read of the same (path, range),
 * replace the body with a short stub before it is appended to history.
 *
 * The comparison is against the NEW read's actual content — never a
 * history-only "probably unchanged" guess — so out-of-band mutations
 * (run_command side-effects, parallel workers editing the same codebase)
 * can never surface a stale "unchanged" claim: changed content simply fails
 * the comparison and the full body is kept.
 */
export function elideDuplicateReads(
  calls: ToolCall[],
  baseHistory: ConversationMessage[],
  toolResultBlocks: ToolResultContentBlock[],
): { blocks: ToolResultContentBlock[]; elided: Array<{ path: string; label: string; chars: number }> } {
  const readCallsById = new Map<string, ToolCall>();
  for (const c of calls) {
    if (c.name === ToolName.READ_FILE) readCallsById.set(c.id, c);
  }
  if (readCallsById.size === 0) return { blocks: toolResultBlocks, elided: [] };

  const preserved = extractLatestReadContent(baseHistory);
  if (preserved.size === 0) return { blocks: toolResultBlocks, elided: [] };

  const elided: Array<{ path: string; label: string; chars: number }> = [];
  const blocks = toolResultBlocks.map((block) => {
    const call = readCallsById.get(block.tool_use_id);
    if (!call || block.is_error) return block;
    const text = stringifyToolResultContent(block.content as string | MessageContentBlock[]);
    if (!text || text.startsWith('Error:')) return block;

    const prior = preserved.get(preservedReadKeyOf(call.args));
    if (!prior || normalizeReadContent(text) !== normalizeReadContent(prior.content)) return block;

    const { label } = readRangeOf(call.args);
    elided.push({ path: prior.path, label, chars: text.length });
    return { ...block, content: buildDuplicateReadStub(prior.path, label) };
  });

  return { blocks, elided };
}

/**
 * Already-read manifest, appended into the persisted tool_result turn ONLY
 * when it changed vs. the previous turn's derivable manifest (new reads or
 * invalidating edits this batch) — unchanged rounds add zero tokens.
 *
 * "Before" excludes the trailing assistant turn: that turn carries the
 * CURRENT batch's tool_use blocks (including any invalidating edit_file), so
 * including it would make edits look like they happened "before" this batch
 * and suppress the manifest update.
 */
export function buildManifestBlockIfChanged(
  baseHistory: ConversationMessage[],
  userContent: MessageContentBlock[],
): TextContentBlock | null {
  const last = baseHistory[baseHistory.length - 1];
  const priorHistory = last?.role === 'assistant' ? baseHistory.slice(0, -1) : baseHistory;

  const before = buildAlreadyReadManifest(extractLatestReadContent(priorHistory));
  const after = buildAlreadyReadManifest(
    extractLatestReadContent([...baseHistory, { role: 'user', content: userContent }]),
  );
  if (!after || after === before) return null;
  return { type: 'text', text: after };
}

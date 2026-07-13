/**
 * Duplicate-read tracking — history-derived, staleness-safe.
 *
 * The conversation history is the SSOT of what a tool loop has read: every
 * successful `read_file` leaves a tool_use/tool_result pair behind. Models
 * across providers still re-request content they already hold verbatim
 * (observed on deepseek and sonnet alike), bloating history with identical
 * bodies and burning rounds. This module derives, per (path, range), the
 * latest still-valid read from the messages — no separate state channel —
 * and provides two consumers:
 *
 *   - `buildDuplicateReadStub` / `isDuplicateReadStub`: the tool node
 *     replaces a re-read's tool_result body with a short stub WHEN THE NEW
 *     READ'S ACTUAL CONTENT is byte-identical to the preserved prior read
 *     (execute-then-compare — never decided from history alone, so
 *     out-of-band mutations by run_command or parallel workers can never
 *     surface a stale "unchanged" claim).
 *   - `buildAlreadyReadManifest`: a compact path+range list (no bodies —
 *     they remain verbatim in earlier tool_results) appended to tool-result
 *     turns so the model sees what it already read.
 *
 * `extractLatestReadContent` is also the compaction consumer's core
 * (compactTurns re-injects preserved bodies after dropping cold turns).
 */

import type { MessageContentBlock } from '../ports/llm';
import type { ConversationMessage } from './types';

/** Flatten a tool_result's content to a plain string for re-injection. */
export function stringifyToolResultContent(content: string | MessageContentBlock[]): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map(b => (b.type === 'text' ? b.text : ''))
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

export interface PreservedRead {
  path: string;
  /** Human-readable range suffix, e.g. " (lines 140-160)"; "" for whole-file. */
  label: string;
  content: string;
}

/** Range descriptor for a read_file tool_use, derived from its input. */
export function readRangeOf(input: Record<string, any> | undefined): { rangeKey: string; label: string } {
  const s = input?.startLine;
  const e = input?.endLine;
  const hasS = typeof s === 'number';
  const hasE = typeof e === 'number';
  if (!hasS && !hasE) return { rangeKey: '', label: '' }; // whole-file read
  const sv = hasS ? String(s) : '';
  const ev = hasE ? String(e) : '';
  return { rangeKey: `${sv}-${ev}`, label: ` (lines ${sv}-${ev})` };
}

/**
 * Walk messages in order and return, per (file path, read range), the content
 * of its MOST RECENT `read_file` that has NO later `edit_file`/`create_file`
 * on the same path.
 *
 * Why keyed by (path, range), not path alone: the old compaction dropped read
 * content entirely (path-only summary), so the model re-read files in a loop
 * until the recursion budget burned (dim-beating-brass RCA). The first fix
 * preserved the latest read PER PATH — but a large file read in multiple
 * line-range chunks then collapsed to its last chunk, so the model lost the
 * earlier chunks and re-read them: the same loop, recurring for ranged reads
 * (grave-bolting-cloud RCA). Keying by (path, range) preserves EVERY distinct
 * chunk. A whole-file read is the range=none point of the same key space, so
 * reading a file whole twice still dedups to latest — identical to the prior
 * path-only behaviour, no separate compatibility branch.
 *
 * Staleness-safe: an edit/create of a path drops ALL preserved ranges of that
 * path (the edit / on-disk state is the truth, surfaced via the
 * `[file edited/written: …]` markers), so we never resurrect pre-edit content.
 *
 * Duplicate-read stubs (see `buildDuplicateReadStub`) are skipped: a stub
 * means "identical to the earlier read", so the earlier full body stays the
 * preserved entry — the stub must never overwrite it.
 */
export function extractLatestReadContent(messages: ConversationMessage[]): Map<string, PreservedRead> {
  const toolUseById = new Map<string, { name: string; path: string; rangeKey: string; label: string }>();
  const preserved = new Map<string, PreservedRead>();

  for (const msg of messages) {
    if (!Array.isArray(msg.content)) continue;
    for (const block of msg.content) {
      if (block.type === 'tool_use' && block.name) {
        const input = block.input as Record<string, any> | undefined;
        const path = input?.path;
        const pathStr = typeof path === 'string' ? path : '';
        if (typeof block.id === 'string') {
          const { rangeKey, label } = readRangeOf(input);
          toolUseById.set(block.id, { name: block.name, path: pathStr, rangeKey, label });
        }
        // A mutation invalidates ALL preserved ranges of that path.
        if ((block.name === 'edit_file' || block.name === 'create_file') && pathStr) {
          for (const [key, entry] of preserved) {
            if (entry.path === pathStr) preserved.delete(key);
          }
        }
      } else if (block.type === 'tool_result') {
        const origin = block.tool_use_id ? toolUseById.get(block.tool_use_id) : undefined;
        const toolName = block.tool_name || origin?.name;
        const path = origin?.path;
        if (toolName === 'read_file' && path && !block.is_error) {
          const text = stringifyToolResultContent(block.content);
          if (text && !isDuplicateReadStub(text)) {
            // (path, range) key — distinct chunks coexist; same chunk re-read
            // moves to latest content.
            const key = JSON.stringify([path, origin?.rangeKey ?? '']);
            preserved.set(key, { path, label: origin?.label ?? '', content: text });
          }
        }
      }
    }
  }
  return preserved;
}

/** Key into the `extractLatestReadContent` map for a read_file input. */
export function preservedReadKeyOf(input: Record<string, any> | undefined): string {
  const path = typeof input?.path === 'string' ? input.path : '';
  return JSON.stringify([path, readRangeOf(input).rangeKey]);
}

// ─── Duplicate-read stub (tool-node consumer) ───

export const DUPLICATE_READ_STUB_PREFIX = '[duplicate read elided:';

export function buildDuplicateReadStub(path: string, label: string): string {
  return (
    `${DUPLICATE_READ_STUB_PREFIX} ${path}${label}] ` +
    'Content is identical to your earlier read_file result of this path+range above — ' +
    'the file has not changed. Use that earlier tool_result; do not re-read unchanged files.'
  );
}

export function isDuplicateReadStub(text: string): boolean {
  return text.startsWith(DUPLICATE_READ_STUB_PREFIX);
}

// ─── Already-read manifest (tool-node consumer) ───

/**
 * Compact path+range list of everything already read and still valid.
 * Bodies are intentionally NOT included — in an active tool loop they remain
 * verbatim in earlier tool_results (unlike the compaction path, which drops
 * cold turns and must re-inject bodies via `buildPreservedReadsText`).
 */
export function buildAlreadyReadManifest(preserved: Map<string, PreservedRead>): string {
  if (preserved.size === 0) return '';
  const items = [...preserved.values()].map(p => `- ${p.path}${p.label}`);
  return (
    'Files already read this task — full contents remain in earlier tool_results above. ' +
    'Do NOT call read_file again for these unchanged path+ranges:\n' +
    items.join('\n')
  );
}

/**
 * Turn-level compaction: when history exceeds a token threshold, replace
 * old turns with a structured rule-based summary (no LLM call).
 *
 * Maintains Anthropic API format by inserting a valid assistant/user
 * message pair as the summary.
 */

import type { MessageContentBlock } from '../ports/llm';
import type { ConversationMessage } from './types';
import { groupMessagesIntoTurns, isErrorContent } from './types';
import {
  DEFAULT_COMPACT_TURNS_THRESHOLD,
  DEFAULT_COMPACT_TURNS_HOT_TAIL,
} from './constants';
import type { TokenBudgetManager } from '../utils/tokenBudget';

// ─── Fact Extraction ───

interface ExtractedFact {
  filesWritten: string[];
  filesEdited: string[];
  filesRead: string[];
  commandsRun: { cmd: string; success: boolean }[];
  errors: string[];
  searchesPerformed: string[];
}

function extractFactsFromMessages(messages: ConversationMessage[]): ExtractedFact {
  const facts: ExtractedFact = {
    filesWritten: [],
    filesEdited: [],
    filesRead: [],
    commandsRun: [],
    errors: [],
    searchesPerformed: [],
  };

  for (const msg of messages) {
    if (!Array.isArray(msg.content)) {
      if (msg.role === 'assistant' && typeof msg.content === 'string') {
        const writtenMatches = msg.content.matchAll(/\[file written to disk: ([^\]]+)\]/g);
        for (const m of writtenMatches) {
          if (m[1] && !facts.filesWritten.includes(m[1])) {
            facts.filesWritten.push(m[1]);
          }
        }
        const appendedMatches = msg.content.matchAll(/\[file appended: ([^\]]+)\]/g);
        for (const m of appendedMatches) {
          if (m[1] && !facts.filesWritten.includes(m[1])) {
            facts.filesWritten.push(m[1]);
          }
        }
        const editedMatches = msg.content.matchAll(/\[file edited: ([^\]]+)\]/g);
        for (const m of editedMatches) {
          if (m[1] && !facts.filesEdited.includes(m[1])) {
            facts.filesEdited.push(m[1]);
          }
        }
      }
      continue;
    }

    for (const block of msg.content) {
      if (block.type === 'tool_use' && block.name && block.input) {
        const input = block.input as Record<string, any>;
        switch (block.name) {
          case 'edit_file':
            if (input.path && !facts.filesEdited.includes(input.path)) {
              facts.filesEdited.push(input.path);
            }
            break;
          case 'read_file':
            if (input.path && !facts.filesRead.includes(input.path)) {
              facts.filesRead.push(input.path);
            }
            break;
          case 'run_command':
            if (input.command) {
              facts.commandsRun.push({ cmd: input.command, success: true });
            }
            break;
          case 'search_code':
          case 'search_reference_code':
            if (input.query || input.pattern) {
              facts.searchesPerformed.push(input.query || input.pattern);
            }
            break;
        }
      }

      if (block.type === 'tool_result' && typeof block.content === 'string') {
        if (isErrorContent(block.content)) {
          const errorSnippet = block.content.split('\n').slice(0, 3).join(' ').slice(0, 200);
          facts.errors.push(errorSnippet);
        }
        if (block.content.includes('❌ COMMAND FAILED') || block.content.includes('exit code: 1')) {
          const lastCmd = facts.commandsRun[facts.commandsRun.length - 1];
          if (lastCmd) lastCmd.success = false;
        }
      }
    }
  }

  return facts;
}

// ─── Read-content preservation (staleness-safe) ───

/** Flatten a tool_result's content to a plain string for re-injection. */
function stringifyToolResultContent(content: string | MessageContentBlock[]): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map(b => (b.type === 'text' ? b.text : ''))
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

interface PreservedRead {
  path: string;
  /** Human-readable range suffix, e.g. " (lines 140-160)"; "" for whole-file. */
  label: string;
  content: string;
}

/** Range descriptor for a read_file tool_use, derived from its input. */
function readRangeOf(input: Record<string, any> | undefined): { rangeKey: string; label: string } {
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
 */
function extractLatestReadContent(messages: ConversationMessage[]): Map<string, PreservedRead> {
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
          if (text) {
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

/**
 * Render the preserved read contents as a labelled block appended to the
 * post-compaction user message, with an explicit do-not-re-read directive.
 */
function buildPreservedReadsText(preserved: Map<string, PreservedRead>): string {
  if (preserved.size === 0) return '';
  const parts: string[] = [
    'Current contents of files already read this task (deduplicated to the ' +
    'latest read of each path+range; files later edited/created are omitted here and ' +
    'reflected by the [file written/edited] markers above). These remain in ' +
    'your context — DO NOT call read_file on them again:',
  ];
  for (const { path, label, content } of preserved.values()) {
    parts.push(`\n===== ${path}${label} =====\n${content}`);
  }
  return parts.join('\n');
}

function buildSummaryText(facts: ExtractedFact, turnCount: number): string {
  const sections: string[] = [];
  sections.push(`[Auto-compacted: ${turnCount} conversation turns summarized]`);
  sections.push('');

  if (facts.filesWritten.length > 0) {
    for (const f of facts.filesWritten) {
      sections.push(`[file written to disk: ${f}]`);
    }
  }
  if (facts.filesEdited.length > 0) {
    for (const f of facts.filesEdited) {
      sections.push(`[file edited: ${f}]`);
    }
  }
  if (facts.filesRead.length > 0) {
    sections.push(`Files read: ${facts.filesRead.join(', ')}`);
  }
  if (facts.commandsRun.length > 0) {
    const succeeded = facts.commandsRun.filter(c => c.success);
    const failed = facts.commandsRun.filter(c => !c.success);
    if (succeeded.length > 0) {
      sections.push(`Commands succeeded: ${succeeded.map(c => c.cmd).join(', ')}`);
    }
    if (failed.length > 0) {
      sections.push(`Commands failed: ${failed.map(c => c.cmd).join(', ')}`);
    }
  }
  if (facts.searchesPerformed.length > 0) {
    sections.push(`Searches: ${facts.searchesPerformed.slice(0, 5).join(', ')}${facts.searchesPerformed.length > 5 ? ` (+${facts.searchesPerformed.length - 5} more)` : ''}`);
  }
  if (facts.errors.length > 0) {
    sections.push('');
    sections.push('Errors encountered:');
    for (const err of facts.errors.slice(0, 5)) {
      sections.push(`  - ${err}`);
    }
  }

  sections.push('');
  sections.push('Note: current contents of files read but not yet modified are preserved in the following message for reference — do NOT re-read them. Files marked [file written to disk: ...] / [file edited: ...] are already saved — do NOT regenerate.');

  return sections.join('\n');
}

/**
 * Auto-compact conversation history when it exceeds a token threshold.
 * Replaces old turns (beyond hot tail) with a structured summary.
 */
export function compactTurns(
  history: ConversationMessage[],
  tokenThreshold: number = DEFAULT_COMPACT_TURNS_THRESHOLD,
  hotTailTurns: number = DEFAULT_COMPACT_TURNS_HOT_TAIL,
  tokenManager?: TokenBudgetManager,
): { compacted: ConversationMessage[]; wasCompacted: boolean; summaryTokens: number } {
  const estimateContent = tokenManager
    ? (c: string | MessageContentBlock[]) => tokenManager.estimateMessageContent(c)
    : (c: string | MessageContentBlock[]) => {
        if (typeof c === 'string') return Math.ceil(c.length / 3.5);
        return Math.ceil(JSON.stringify(c).length / 3.5);
      };

  const totalTokens = history.reduce((sum, msg) => sum + estimateContent(msg.content), 0);

  if (totalTokens <= tokenThreshold) {
    return { compacted: history, wasCompacted: false, summaryTokens: 0 };
  }

  const turns = groupMessagesIntoTurns(history);

  if (turns.length <= hotTailTurns) {
    return { compacted: history, wasCompacted: false, summaryTokens: 0 };
  }

  const coldTurns = turns.slice(0, turns.length - hotTailTurns);
  const hotTurns = turns.slice(turns.length - hotTailTurns);
  const coldMessages = coldTurns.flat();

  const facts = extractFactsFromMessages(coldMessages);
  const summaryText = buildSummaryText(facts, coldTurns.length);

  // Preserve the latest read content of still-relevant files (dedup +
  // staleness-safe) so the model never re-reads what it already read.
  const latestReads = extractLatestReadContent(coldMessages);
  const preservedText = buildPreservedReadsText(latestReads);
  const userText = preservedText
    ? `Acknowledged. Continue with the current task.\n\n${preservedText}`
    : 'Acknowledged. Continue with the current task.';

  const summaryMessages: ConversationMessage[] = [
    { role: 'assistant', content: summaryText },
    { role: 'user', content: userText },
  ];

  const compacted = [...summaryMessages, ...hotTurns.flat()];
  const summaryTokens = estimateContent(summaryText);
  const compactedTokens = compacted.reduce((sum, msg) => sum + estimateContent(msg.content), 0);

  console.log(
    `\n🗜️  [AutoCompaction] Triggered (${totalTokens.toLocaleString()} > ${tokenThreshold.toLocaleString()} threshold)\n` +
    `   Compacted ${coldTurns.length} old turns → ${summaryText.split('\n').length}-line summary\n` +
    `   Before: ${totalTokens.toLocaleString()} tokens → After: ${compactedTokens.toLocaleString()} tokens\n` +
    `   Hot tail: ${hotTailTurns} turns preserved`,
  );

  return { compacted, wasCompacted: true, summaryTokens };
}

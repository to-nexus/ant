/**
 * Sub-turn compaction: shrink old tool_result content blocks while preserving
 * Anthropic API format (tool_use / tool_result pairing).
 *
 * Works on a shallow copy — does NOT mutate the original history.
 */

import type { ConversationMessage } from './types';
import { isErrorContent } from './types';
import {
  COMPACTABLE_TOOLS,
  MIN_CONTENT_TOKENS_TO_COMPACT,
  DEFAULT_COMPACT_TOOL_RESULTS_HOT_TAIL,
} from './constants';
import type { TokenBudgetManager } from '../utils/tokenBudget';

function compactToolResultContent(toolName: string, content: string): string {
  if (!content || typeof content !== 'string') return content;

  if (toolName === 'read_file' || toolName === 'read_source_doc') {
    const lineCount = content.split('\n').length;
    return `[${toolName} result: ${lineCount} lines — content omitted]`;
  }

  if (toolName === 'search_code' || toolName === 'search_reference_code') {
    const lines = content.split('\n');
    const fileMatches = lines.filter(l => l.includes(':') && !l.startsWith(' ') && !l.startsWith('\t'));
    const filePaths = fileMatches.slice(0, 10).map(l => l.split(':')[0]).filter(Boolean);
    const uniqueFiles = [...new Set(filePaths)];
    return `[search result: ${uniqueFiles.length} file(s) matched — ${uniqueFiles.slice(0, 5).join(', ')}${uniqueFiles.length > 5 ? `, ... and ${uniqueFiles.length - 5} more` : ''} — re-search if needed]`;
  }

  if (toolName === 'run_command') {
    const lines = content.split('\n');
    const succeeded = content.includes('✅ COMMAND SUCCEEDED') || content.includes('Exit Code: 0');
    if (succeeded) {
      return `[command succeeded — output omitted (${lines.length} lines)]`;
    }
    return content;
  }

  if (toolName === 'list_files') {
    const lines = content.split('\n').filter(Boolean);
    return `[list_files: ${lines.length} entries — re-list if needed]`;
  }

  return content;
}

/**
 * Microcompact tool_result content blocks in conversation history.
 * Only modifies content outside the hot tail window.
 *
 * @param history  - conversation messages (will be shallow-copied)
 * @param hotTailTurns - number of recent turns to keep uncompacted
 * @param tokenManager - for estimating content size
 */
export function compactToolResults(
  history: ConversationMessage[],
  hotTailTurns: number = DEFAULT_COMPACT_TOOL_RESULTS_HOT_TAIL,
  tokenManager?: TokenBudgetManager,
): { compacted: ConversationMessage[]; savedTokens: number; compactedResults: number } {
  if (history.length === 0) {
    return { compacted: [], savedTokens: 0, compactedResults: 0 };
  }

  const turns: { startIdx: number; endIdx: number }[] = [];
  let turnStart = 0;
  for (let i = 0; i < history.length; i++) {
    if (i > 0 && history[i].role === 'assistant') {
      turns.push({ startIdx: turnStart, endIdx: i - 1 });
      turnStart = i;
    }
  }
  turns.push({ startIdx: turnStart, endIdx: history.length - 1 });

  const hotTailStart = turns.length > hotTailTurns
    ? turns[turns.length - hotTailTurns].startIdx
    : 0;

  let savedTokens = 0;
  let compactedResults = 0;
  const estimateTokens = tokenManager
    ? (s: string) => tokenManager.estimateTokens(s)
    : (s: string) => Math.ceil((s || '').length / 3.5);

  const result: ConversationMessage[] = history.map((msg, idx) => {
    if (idx >= hotTailStart) return msg;
    if (msg.role !== 'user') return msg;
    if (typeof msg.content === 'string') return msg;
    if (!Array.isArray(msg.content)) return msg;

    const hasToolResult = msg.content.some((b: any) => b.type === 'tool_result');
    if (!hasToolResult) return msg;

    const pairedAssistant = idx > 0 ? history[idx - 1] : null;
    const toolNameMap = new Map<string, string>();
    if (pairedAssistant && Array.isArray(pairedAssistant.content)) {
      for (const block of pairedAssistant.content) {
        if (block.type === 'tool_use' && block.id && block.name) {
          toolNameMap.set(block.id, block.name);
        }
      }
    }

    let msgChanged = false;
    const newContent = msg.content.map((block: any) => {
      if (block.type !== 'tool_result') return block;
      if (!block.content || typeof block.content !== 'string') return block;

      const toolName = toolNameMap.get(block.tool_use_id) || '';
      if (!COMPACTABLE_TOOLS.has(toolName)) return block;

      const originalTokens = estimateTokens(block.content);
      if (originalTokens < MIN_CONTENT_TOKENS_TO_COMPACT) return block;

      if (isErrorContent(block.content)) return block;

      const compactedContent = compactToolResultContent(toolName, block.content);
      const newTokens = estimateTokens(compactedContent);
      savedTokens += originalTokens - newTokens;
      compactedResults++;
      msgChanged = true;

      return { ...block, content: compactedContent };
    });

    return msgChanged ? { ...msg, content: newContent } : msg;
  });

  if (compactedResults > 0) {
    console.log(`\n📦 [Microcompaction] Compacted ${compactedResults} tool result(s), saved ~${savedTokens.toLocaleString()} tokens (hot tail: last ${hotTailTurns} turns preserved)`);
  }

  return { compacted: result, savedTokens, compactedResults };
}

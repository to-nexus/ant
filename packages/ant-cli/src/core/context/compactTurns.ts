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
  sections.push('Note: File contents from compacted turns are no longer available. Files marked [file written to disk: ...] are already saved — do NOT regenerate.');

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

  const summaryMessages: ConversationMessage[] = [
    { role: 'assistant', content: summaryText },
    { role: 'user', content: 'Acknowledged. Continue with the current task.' },
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

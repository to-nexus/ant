/**
 * Conversation History Manager
 * 
 * 책임:
 * - 대화 히스토리 압축 및 pruning
 * - Tool call/result 쌍 보존
 * - 토큰 예산 내에서 최대한 많은 컨텍스트 유지
 * 
 * 전략:
 * 1. Tool call/result는 쌍으로 보존 (분리 불가)
 * 2. 오래된 메시지부터 제거
 * 3. 최소 N개의 최근 turn은 항상 보존
 * 4. 중요 메시지 (에러, setup 등)는 우선순위 부여
 */

import { TokenBudgetManager } from './tokenBudget';

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string | any[];
}

export interface HistoryPruneConfig {
  maxTokens: number;              // 최대 토큰 (history만 해당, system prompt 제외)
  minTurnsToKeep: number;         // 최소 보존 turn 수 (기본: 3)
  prioritizeErrors: boolean;      // 에러 메시지 우선순위 (기본: true)
  prioritizeSetup: boolean;       // Setup task 우선순위 (기본: true)
}

export class HistoryManager {
  private tokenManager: TokenBudgetManager;
  private config: HistoryPruneConfig;
  
  constructor(
    tokenManager: TokenBudgetManager,
    config?: Partial<HistoryPruneConfig>
  ) {
    this.tokenManager = tokenManager;
    this.config = {
      maxTokens: config?.maxTokens || 75000,  // History limit (increased to 50K for better context retention - 25% of 200K context window)
      minTurnsToKeep: config?.minTurnsToKeep || 3,
      prioritizeErrors: config?.prioritizeErrors !== false,
      prioritizeSetup: config?.prioritizeSetup !== false,
    };
  }
  
  /**
   * 대화 히스토리를 토큰 예산 내로 압축
   * 
   * 알고리즘:
   * 1. Tool call/result 쌍 식별
   * 2. 각 turn의 토큰 수 계산
   * 3. 최신 turn부터 역순으로 보존 (minTurnsToKeep까지)
   * 4. 토큰 예산 초과 시 오래된 turn 제거
   * 5. 우선순위 메시지는 최대한 보존
   */
  pruneHistory(history: ConversationMessage[]): {
    prunedHistory: ConversationMessage[];
    removedCount: number;
    savedTokens: number;
  } {
    if (history.length === 0) {
      return {
        prunedHistory: [],
        removedCount: 0,
        savedTokens: 0,
      };
    }
    
    // 1. Turn 단위로 그룹화 (assistant + user pair)
    const turns = this.groupIntoTurns(history);
    
    // 2. 각 turn의 토큰 및 우선순위 계산
    const turnMetadata = turns.map(turn => ({
      messages: turn,
      tokens: turn.reduce((sum, msg) => 
        sum + this.tokenManager.estimateMessageContent(msg.content), 0
      ),
      priority: this.calculatePriority(turn),
    }));
    
    // 3. 최신 turn부터 보존 (minTurnsToKeep)
    const mustKeep = turnMetadata.slice(-this.config.minTurnsToKeep);
    const candidates = turnMetadata.slice(0, -this.config.minTurnsToKeep);
    
    // 4. 우선순위 순으로 정렬 (높은 순)
    candidates.sort((a, b) => b.priority - a.priority);
    
    // 5. 토큰 예산 내에서 최대한 포함
    let currentTokens = mustKeep.reduce((sum, t) => sum + t.tokens, 0);
    const kept: typeof turnMetadata = [...mustKeep];
    
    for (const candidate of candidates) {
      if (currentTokens + candidate.tokens <= this.config.maxTokens) {
        kept.push(candidate);
        currentTokens += candidate.tokens;
      }
    }
    
    // 6. 시간 순서로 재정렬
    const keptMessages = new Set(kept.flatMap(t => t.messages));
    const prunedHistory = history.filter(msg => keptMessages.has(msg));
    
    const originalTokens = history.reduce((sum, msg) => 
      sum + this.tokenManager.estimateMessageContent(msg.content), 0
    );
    const savedTokens = originalTokens - currentTokens;
    const removedCount = history.length - prunedHistory.length;
    
    if (removedCount > 0) {
      console.log(`\n🗜️  [HistoryManager] Pruned conversation history:`);
      console.log(`   Removed: ${removedCount} messages`);
      console.log(`   Saved: ${savedTokens.toLocaleString()} tokens`);
      console.log(`   Kept: ${prunedHistory.length} messages (${currentTokens.toLocaleString()} tokens)`);
    }
    
    return {
      prunedHistory,
      removedCount,
      savedTokens,
    };
  }
  
  private groupIntoTurns(history: ConversationMessage[]): ConversationMessage[][] {
    return groupMessagesIntoTurns(history);
  }
  
  /**
   * Turn의 우선순위 계산
   * 높을수록 중요 (보존 우선)
   */
  private calculatePriority(turn: ConversationMessage[]): number {
    let priority = 0;
    
    const content = JSON.stringify(turn);
    const lowerContent = content.toLowerCase();
    
    // 에러 메시지 우선순위
    if (this.config.prioritizeErrors) {
      if (lowerContent.includes('error') || 
          lowerContent.includes('failed') ||
          lowerContent.includes('exception')) {
        priority += 10;
      }
    }
    
    // Setup task 우선순위
    if (this.config.prioritizeSetup) {
      if (lowerContent.includes('setup') ||
          lowerContent.includes('npm install') ||
          lowerContent.includes('dependencies')) {
        priority += 5;
      }
    }
    
    // Tool result 크기에 따라 우선순위 감소
    // (큰 tool result는 덜 중요할 가능성 높음)
    const tokens = turn.reduce((sum, msg) => 
      sum + this.tokenManager.estimateMessageContent(msg.content), 0
    );
    
    if (tokens > 10000) {
      priority -= 5;  // 매우 큰 결과 (예: 216개 search 결과)
    } else if (tokens > 5000) {
      priority -= 2;
    }
    
    return priority;
  }
  
  /**
   * 특정 메시지가 tool_result인지 확인
   */
  private isToolResult(msg: ConversationMessage): boolean {
    if (typeof msg.content === 'string') return false;
    if (!Array.isArray(msg.content)) return false;
    
    return msg.content.some(block => block.type === 'tool_result');
  }
}

/**
 * Universal 3-step history compaction pipeline.
 * Replaces per-builder copy-paste with a single call.
 *
 * Steps:
 *   1. Microcompact  – shrink old tool_result blobs (hot-tail untouched)
 *   2. Auto-compact  – if still >50 K tokens, summarise cold turns
 *   3. Prune         – trim to final token budget via priority-based pruning
 *
 * @returns compacted history + wasCompacted flag (for cache-control decisions)
 */
export function compactAndPruneHistory(
  history: ConversationMessage[],
  tokenManager: TokenBudgetManager,
  options?: {
    microcompactHotTail?: number;   // default 3
    autoCompactThreshold?: number;  // default 50 000
    autoCompactHotTail?: number;    // default 5
  }
): { result: ConversationMessage[]; wasCompacted: boolean } {
  if (history.length === 0) {
    return { result: [], wasCompacted: false };
  }
  const { microcompactHotTail = 3, autoCompactThreshold = 50000, autoCompactHotTail = 5 } = options || {};

  const { compacted: step1 } = microcompactToolResults(history, microcompactHotTail, tokenManager);
  const { compacted: step2, wasCompacted } = autoCompactHistory(step1, autoCompactThreshold, autoCompactHotTail, tokenManager);

  const historyManager = new HistoryManager(tokenManager);
  const { prunedHistory } = historyManager.pruneHistory(step2);

  return { result: prunedHistory, wasCompacted };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Microcompaction: shrink old tool_result content while preserving
// Anthropic API format (tool_use / tool_result pairing).
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const COMPACTABLE_TOOLS = new Set(['read_file', 'search_code', 'run_command', 'list_files', 'search_reference_code']);
const MIN_CONTENT_TOKENS_TO_COMPACT = 200;

function isErrorContent(content: string): boolean {
  if (!content) return false;
  const lower = content.toLowerCase();
  return lower.startsWith('error:') ||
    lower.includes('❌ command failed') ||
    lower.includes('exit code: 1') ||
    lower.includes('exited with error') ||
    (lower.includes('error') && lower.includes('failed'));
}

function compactToolResultContent(toolName: string, content: string): string {
  if (!content || typeof content !== 'string') return content;

  if (toolName === 'read_file') {
    const lineCount = content.split('\n').length;
    return `[read_file result: ${lineCount} lines — content omitted, re-read with read_file if needed for edit_file]`;
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
 * Preserves Anthropic API format (tool_use/tool_result pairing intact).
 * Only modifies the content string inside tool_result blocks for turns
 * outside the hot tail window.
 *
 * IMPORTANT: Works on a shallow copy — does NOT mutate the original history.
 *
 * @param history  - conversation messages (will be shallow-copied)
 * @param hotTailTurns - number of recent turns to keep uncompacted (default 3)
 * @param tokenManager - for estimating content size
 * @returns new array with compacted messages + stats
 */
export function microcompactToolResults(
  history: ConversationMessage[],
  hotTailTurns: number = 3,
  tokenManager?: TokenBudgetManager
): { compacted: ConversationMessage[]; savedTokens: number; compactedResults: number } {
  if (history.length === 0) {
    return { compacted: [], savedTokens: 0, compactedResults: 0 };
  }

  // Group into turns to identify hot tail boundary
  const turns: { startIdx: number; endIdx: number }[] = [];
  let turnStart = 0;
  for (let i = 0; i < history.length; i++) {
    if (i > 0 && history[i].role === 'assistant') {
      turns.push({ startIdx: turnStart, endIdx: i - 1 });
      turnStart = i;
    }
  }
  turns.push({ startIdx: turnStart, endIdx: history.length - 1 });

  // Messages in the hot tail (last N turns) are untouched
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

    // Find paired assistant message to get tool names
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

      // Preserve error results (critical for debugging loops)
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

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Auto-compaction: when history exceeds a token threshold, replace
// old turns with a structured summary. No LLM call needed — uses
// rule-based extraction from tool_use/tool_result blocks.
//
// Maintains Anthropic API format by inserting a valid
// assistant/user message pair as the summary.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

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
      // Assistant messages are cleaned by cleanFileContentFromResponse before
      // entering history, so XML tags are replaced with markers:
      //   <file path="x">...</file>   → [file written to disk: x]
      //   <edit path="x">...</edit>   → [file edited: x]
      //   <append path="x">...</append> → [file appended: x]
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
      // Extract from tool_use blocks
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

      // Extract error info from tool_result blocks
      if (block.type === 'tool_result' && typeof block.content === 'string') {
        if (isErrorContent(block.content)) {
          const errorSnippet = block.content.split('\n').slice(0, 3).join(' ').slice(0, 200);
          facts.errors.push(errorSnippet);
        }
        // Mark failed commands
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
    sections.push(`Files created: ${facts.filesWritten.join(', ')}`);
  }
  if (facts.filesEdited.length > 0) {
    sections.push(`Files edited: ${facts.filesEdited.join(', ')}`);
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
  sections.push('Note: File contents from compacted turns are no longer available. Use read_file to re-read any file before editing.');

  return sections.join('\n');
}

function groupMessagesIntoTurns(history: ConversationMessage[]): ConversationMessage[][] {
  const turns: ConversationMessage[][] = [];
  let currentTurn: ConversationMessage[] = [];

  for (const msg of history) {
    if (msg.role === 'assistant') {
      if (currentTurn.length > 0) {
        turns.push(currentTurn);
      }
      currentTurn = [msg];
    } else {
      currentTurn.push(msg);
    }
  }
  if (currentTurn.length > 0) {
    turns.push(currentTurn);
  }
  return turns;
}

/**
 * Auto-compact conversation history when it exceeds a token threshold.
 * Replaces old turns (beyond hot tail) with a structured summary.
 *
 * Summary format: an assistant message describing what was done,
 * followed by a user "acknowledged" message to maintain alternation.
 *
 * @param history - conversation messages
 * @param tokenThreshold - trigger compaction above this (default 50000)
 * @param hotTailTurns - recent turns to preserve in full (default 5)
 * @param tokenManager - for token estimation
 */
export function autoCompactHistory(
  history: ConversationMessage[],
  tokenThreshold: number = 50000,
  hotTailTurns: number = 5,
  tokenManager?: TokenBudgetManager
): { compacted: ConversationMessage[]; wasCompacted: boolean; summaryTokens: number } {
  const estimateContent = tokenManager
    ? (c: string | any[]) => tokenManager.estimateMessageContent(c)
    : (c: string | any[]) => {
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
    `   Hot tail: ${hotTailTurns} turns preserved`
  );

  return { compacted, wasCompacted: true, summaryTokens };
}


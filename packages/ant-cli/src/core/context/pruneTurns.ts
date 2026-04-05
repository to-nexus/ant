/**
 * Turn-level pruning: priority-based turn removal within a token budget.
 *
 * Unconditionally preserves the most recent N turns, then fills the budget
 * with remaining turns ordered by priority (errors > setup > small > large).
 */

import type { ConversationMessage } from './types';
import { groupMessagesIntoTurns } from './types';
import { DEFAULT_PRUNE_TURNS_MAX_TOKENS, DEFAULT_PRUNE_TURNS_MIN_KEEP } from './constants';
import type { TokenBudgetManager } from '../utils/tokenBudget';

export interface TurnPruneConfig {
  maxTokens: number;
  minTurnsToKeep: number;
  prioritizeErrors: boolean;
  prioritizeSetup: boolean;
}

/**
 * Priority-based turn pruner. Extracted from the former HistoryManager class.
 */
export class TurnPruner {
  private tokenManager: TokenBudgetManager;
  private config: TurnPruneConfig;

  constructor(
    tokenManager: TokenBudgetManager,
    config?: Partial<TurnPruneConfig>,
  ) {
    this.tokenManager = tokenManager;
    this.config = {
      maxTokens: config?.maxTokens ?? DEFAULT_PRUNE_TURNS_MAX_TOKENS,
      minTurnsToKeep: config?.minTurnsToKeep ?? DEFAULT_PRUNE_TURNS_MIN_KEEP,
      prioritizeErrors: config?.prioritizeErrors !== false,
      prioritizeSetup: config?.prioritizeSetup !== false,
    };
  }

  pruneHistory(history: ConversationMessage[]): {
    prunedHistory: ConversationMessage[];
    removedCount: number;
    savedTokens: number;
  } {
    if (history.length === 0) {
      return { prunedHistory: [], removedCount: 0, savedTokens: 0 };
    }

    const turns = groupMessagesIntoTurns(history);

    const turnMetadata = turns.map(turn => ({
      messages: turn,
      tokens: turn.reduce((sum, msg) =>
        sum + this.tokenManager.estimateMessageContent(msg.content), 0,
      ),
      priority: this.calculatePriority(turn),
    }));

    const mustKeep = turnMetadata.slice(-this.config.minTurnsToKeep);
    const candidates = turnMetadata.slice(0, -this.config.minTurnsToKeep);

    candidates.sort((a, b) => b.priority - a.priority);

    let currentTokens = mustKeep.reduce((sum, t) => sum + t.tokens, 0);
    const kept: typeof turnMetadata = [...mustKeep];

    for (const candidate of candidates) {
      if (currentTokens + candidate.tokens <= this.config.maxTokens) {
        kept.push(candidate);
        currentTokens += candidate.tokens;
      }
    }

    const keptMessages = new Set(kept.flatMap(t => t.messages));
    const prunedHistory = history.filter(msg => keptMessages.has(msg));

    const originalTokens = history.reduce((sum, msg) =>
      sum + this.tokenManager.estimateMessageContent(msg.content), 0,
    );
    const savedTokens = originalTokens - currentTokens;
    const removedCount = history.length - prunedHistory.length;

    if (removedCount > 0) {
      console.log(`\n🗜️  [TurnPruner] Pruned conversation history:`);
      console.log(`   Removed: ${removedCount} messages`);
      console.log(`   Saved: ${savedTokens.toLocaleString()} tokens`);
      console.log(`   Kept: ${prunedHistory.length} messages (${currentTokens.toLocaleString()} tokens)`);
    }

    return { prunedHistory, removedCount, savedTokens };
  }

  private calculatePriority(turn: ConversationMessage[]): number {
    let priority = 0;

    const content = JSON.stringify(turn);
    const lowerContent = content.toLowerCase();

    if (this.config.prioritizeErrors) {
      if (lowerContent.includes('error') ||
          lowerContent.includes('failed') ||
          lowerContent.includes('exception')) {
        priority += 10;
      }
    }

    if (this.config.prioritizeSetup) {
      if (lowerContent.includes('setup') ||
          lowerContent.includes('npm install') ||
          lowerContent.includes('dependencies')) {
        priority += 5;
      }
    }

    const tokens = turn.reduce((sum, msg) =>
      sum + this.tokenManager.estimateMessageContent(msg.content), 0,
    );

    if (tokens > 10000) {
      priority -= 5;
    } else if (tokens > 5000) {
      priority -= 2;
    }

    return priority;
  }
}

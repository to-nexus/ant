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
  
  /**
   * 메시지를 turn 단위로 그룹화
   * Turn = assistant message + following user message (tool result)
   */
  private groupIntoTurns(history: ConversationMessage[]): ConversationMessage[][] {
    const turns: ConversationMessage[][] = [];
    let currentTurn: ConversationMessage[] = [];
    
    for (const msg of history) {
      if (msg.role === 'assistant') {
        // 이전 turn 완료
        if (currentTurn.length > 0) {
          turns.push(currentTurn);
        }
        currentTurn = [msg];
      } else {
        // user message (tool result or continuation)
        currentTurn.push(msg);
      }
    }
    
    // 마지막 turn 추가
    if (currentTurn.length > 0) {
      turns.push(currentTurn);
    }
    
    return turns;
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


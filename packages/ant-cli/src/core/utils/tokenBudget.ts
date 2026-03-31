/**
 * Token Budget Management System
 * 
 * 책임:
 * - 토큰 추정 (문자열 → 토큰 수)
 * - Anthropic 메시지 포맷의 토큰 계산
 * - 토큰 예산 관리 및 초과 감지
 * 
 * 설계 원칙:
 * - Conservative estimation (실제보다 약간 많게 추정)
 * - Anthropic message format 지원 (string | any[])
 * - Zero dependencies on LLM client
 */

export interface TokenAreaBudgets {
  systemPrompt: number;         // System prompt + rules + profile
  projectContext: number;       // PRD, design docs, codebase context
  taskContext: number;           // Current task, plan, file tree, violations
  conversationHistory: number;  // Tool call/result history
}

export interface TokenBudgetConfig {
  maxTokens: number;           // 최대 허용 토큰 (Anthropic limit: 200K)
  safetyMargin: number;         // 안전 마진 (기본: 10%)
  warningThreshold: number;     // 경고 임계값 (기본: 80%)
  toolOverheadTokens: number;   // Tool definitions overhead (not in messages)
  perMessageOverhead: number;   // Per-message format overhead (role markers, etc.)
  areaBudgets: TokenAreaBudgets;
}

export interface TokenEstimation {
  totalTokens: number;
  breakdown: {
    systemPrompt: number;
    conversationHistory: number;
    currentMessage: number;
    overhead: number;
  };
  isOverBudget: boolean;
  isNearLimit: boolean;
  budgetUsagePercent: number;
}

export class TokenBudgetManager {
  private config: TokenBudgetConfig;
  
  constructor(config?: Partial<TokenBudgetConfig>) {
    this.config = {
      maxTokens: config?.maxTokens || 200000,  // Anthropic limit
      safetyMargin: config?.safetyMargin || 0.10,  // 10% margin
      warningThreshold: config?.warningThreshold || 0.80,  // 80% threshold
      toolOverheadTokens: config?.toolOverheadTokens || 2000,  // ~7-8 tools × ~250 tokens each
      perMessageOverhead: config?.perMessageOverhead || 10,  // role markers, separators
      areaBudgets: config?.areaBudgets || {
        systemPrompt: 30000,        // ~15% — base.md + rules.md + profile
        projectContext: 30000,      // ~15% — PRD, design doc, codebase context
        taskContext: 25000,         // ~12.5% — task plan, file tree, violations
        conversationHistory: 75000, // ~37.5% — matches HistoryManager.maxTokens
        // Remaining ~20K is safety margin + output tokens
      },
    };
  }

  getAreaBudgets(): TokenAreaBudgets {
    return { ...this.config.areaBudgets };
  }

  getHistoryBudget(): number {
    return this.config.areaBudgets.conversationHistory;
  }
  
  /**
   * 문자열의 토큰 수 추정
   * Conservative: 1 token ≈ 2.8 chars for code/markdown mixed content.
   * Measured from actual Anthropic API: 410K chars → 210K tokens ≈ 1.95 ratio,
   * but that includes API overhead. 2.8 balances accuracy with avoiding false alarms.
   */
  estimateTokens(text: string): number {
    if (!text) return 0;
    return Math.ceil(text.length / 2.8);
  }
  
  /**
   * Anthropic 메시지 콘텐츠의 토큰 추정
   * 지원 포맷:
   * - string
   * - array of { type: 'text', text: string }
   * - array of { type: 'tool_use', ... }
   * - array of { type: 'tool_result', content: string | any[] }
   * - array of { type: 'image', source: { data: string } }
   */
  estimateMessageContent(content: string | any[]): number {
    if (typeof content === 'string') {
      return this.estimateTokens(content);
    }
    
    if (!Array.isArray(content)) {
      return 0;
    }
    
    let total = 0;
    for (const block of content) {
      if (block.type === 'text' && block.text) {
        total += this.estimateTokens(block.text);
      } else if (block.type === 'image') {
        total += this.estimateImageTokens(block.source);
      } else if (block.type === 'tool_use') {
        total += this.estimateTokens(block.name || '');
        total += this.estimateTokens(JSON.stringify(block.input || {}));
      } else if (block.type === 'tool_result') {
        if (typeof block.content === 'string') {
          total += this.estimateTokens(block.content);
        } else if (Array.isArray(block.content)) {
          total += this.estimateMessageContent(block.content);
        }
      }
    }
    
    return total;
  }

  /**
   * Anthropic image token estimation.
   * Anthropic charges based on image dimensions, not base64 size.
   * Formula: ceil(width/32) * ceil(height/32) tokens (approx).
   * Without dimension info, estimate from base64 byte size as a conservative proxy.
   * A typical 1280x800 screenshot ≈ 1600 tokens.
   */
  estimateImageTokens(source?: { data?: string; media_type?: string }): number {
    if (!source?.data) return 0;
    const bytes = Math.ceil(source.data.length * 0.75);
    if (bytes < 50_000) return 800;
    if (bytes < 200_000) return 1600;
    return 2400;
  }
  
  /**
   * 전체 메시지 배열의 토큰 추정
   */
  estimateMessages(messages: Array<{ role: string; content: string | any[] }>): TokenEstimation {
    let systemPrompt = 0;
    let conversationHistory = 0;
    let currentMessage = 0;
    
    // First message is typically the system prompt + current request
    if (messages.length > 0) {
      systemPrompt = this.estimateMessageContent(messages[0].content);
    }
    
    // Rest are conversation history
    if (messages.length > 1) {
      const lastMsg = messages[messages.length - 1];
      if (lastMsg.role === 'user') {
        currentMessage = this.estimateMessageContent(lastMsg.content);
      }
      
      for (let i = 1; i < messages.length - 1; i++) {
        conversationHistory += this.estimateMessageContent(messages[i].content);
      }
      
      if (lastMsg.role === 'assistant') {
        conversationHistory += this.estimateMessageContent(lastMsg.content);
      }
    }
    
    const overhead = this.config.toolOverheadTokens
      + (messages.length * this.config.perMessageOverhead);
    const totalTokens = systemPrompt + conversationHistory + currentMessage + overhead;
    const effectiveLimit = this.config.maxTokens * (1 - this.config.safetyMargin);
    const warningLimit = this.config.maxTokens * this.config.warningThreshold;
    
    return {
      totalTokens,
      breakdown: {
        systemPrompt,
        conversationHistory,
        currentMessage,
        overhead,
      },
      isOverBudget: totalTokens > effectiveLimit,
      isNearLimit: totalTokens > warningLimit,
      budgetUsagePercent: (totalTokens / this.config.maxTokens) * 100,
    };
  }
  
  /**
   * 토큰 예산 체크 및 로깅
   */
  checkBudget(messages: Array<{ role: string; content: string | any[] }>): TokenEstimation {
    const estimation = this.estimateMessages(messages);
    
    console.log(`\n📊 [TokenBudget] Estimation:`);
    console.log(`   System Prompt: ${estimation.breakdown.systemPrompt.toLocaleString()} tokens`);
    console.log(`   Conversation History: ${estimation.breakdown.conversationHistory.toLocaleString()} tokens`);
    console.log(`   Current Message: ${estimation.breakdown.currentMessage.toLocaleString()} tokens`);
    console.log(`   Overhead (tools+format): ${estimation.breakdown.overhead.toLocaleString()} tokens`);
    console.log(`   Total: ${estimation.totalTokens.toLocaleString()} / ${this.config.maxTokens.toLocaleString()} tokens (${estimation.budgetUsagePercent.toFixed(1)}%)`);
    
    if (estimation.isOverBudget) {
      console.error(`❌ [TokenBudget] OVER BUDGET! Exceeds safe limit.`);
    } else if (estimation.isNearLimit) {
      console.warn(`⚠️  [TokenBudget] Near limit (>${this.config.warningThreshold * 100}%).`);
    } else {
      console.log(`✅ [TokenBudget] Within safe limits.`);
    }

    // Area-level warnings
    const areas = this.config.areaBudgets;
    const { systemPrompt: sp, conversationHistory: ch } = estimation.breakdown;
    if (sp > areas.systemPrompt + areas.projectContext + areas.taskContext) {
      console.warn(`⚠️  [TokenBudget] First message (${sp.toLocaleString()}) exceeds combined area budget (${(areas.systemPrompt + areas.projectContext + areas.taskContext).toLocaleString()})`);
    }
    if (ch > areas.conversationHistory) {
      console.warn(`⚠️  [TokenBudget] History (${ch.toLocaleString()}) exceeds area budget (${areas.conversationHistory.toLocaleString()})`);
    }
    
    return estimation;
  }
}

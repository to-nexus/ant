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

export interface TokenBudgetConfig {
  maxTokens: number;           // 최대 허용 토큰 (Anthropic limit: 200K)
  safetyMargin: number;         // 안전 마진 (기본: 10%)
  warningThreshold: number;     // 경고 임계값 (기본: 80%)
}

export interface TokenEstimation {
  totalTokens: number;
  breakdown: {
    systemPrompt: number;
    conversationHistory: number;
    currentMessage: number;
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
    };
  }
  
  /**
   * 문자열의 토큰 수 추정
   * 보수적 추정: 1 token ≈ 3.5 chars (실제는 ~4, 안전하게 3.5 사용)
   */
  estimateTokens(text: string): number {
    if (!text) return 0;
    return Math.ceil(text.length / 3.5);
  }
  
  /**
   * Anthropic 메시지 콘텐츠의 토큰 추정
   * 지원 포맷:
   * - string
   * - array of { type: 'text', text: string }
   * - array of { type: 'tool_use', ... }
   * - array of { type: 'tool_result', content: string }
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
      } else if (block.type === 'tool_use') {
        // tool_use: name + input (JSON)
        total += this.estimateTokens(block.name || '');
        total += this.estimateTokens(JSON.stringify(block.input || {}));
      } else if (block.type === 'tool_result') {
        // tool_result: content (can be very large!)
        total += this.estimateTokens(block.content || '');
      }
    }
    
    return total;
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
      // Last message is current (if it's a continuation)
      const lastMsg = messages[messages.length - 1];
      if (lastMsg.role === 'user') {
        currentMessage = this.estimateMessageContent(lastMsg.content);
      }
      
      // Middle messages are history
      for (let i = 1; i < messages.length - 1; i++) {
        conversationHistory += this.estimateMessageContent(messages[i].content);
      }
      
      // If last message is assistant, it's also history
      if (lastMsg.role === 'assistant') {
        conversationHistory += this.estimateMessageContent(lastMsg.content);
      }
    }
    
    const totalTokens = systemPrompt + conversationHistory + currentMessage;
    const effectiveLimit = this.config.maxTokens * (1 - this.config.safetyMargin);
    const warningLimit = this.config.maxTokens * this.config.warningThreshold;
    
    return {
      totalTokens,
      breakdown: {
        systemPrompt,
        conversationHistory,
        currentMessage,
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
    console.log(`   Total: ${estimation.totalTokens.toLocaleString()} / ${this.config.maxTokens.toLocaleString()} tokens (${estimation.budgetUsagePercent.toFixed(1)}%)`);
    
    if (estimation.isOverBudget) {
      console.error(`❌ [TokenBudget] OVER BUDGET! Exceeds safe limit.`);
    } else if (estimation.isNearLimit) {
      console.warn(`⚠️  [TokenBudget] Near limit (>${this.config.warningThreshold * 100}%).`);
    } else {
      console.log(`✅ [TokenBudget] Within safe limits.`);
    }
    
    return estimation;
  }
}


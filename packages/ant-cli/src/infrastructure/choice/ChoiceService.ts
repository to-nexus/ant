/**
 * Choice Service
 * 
 * Triage 결과에 따른 사용자 선택 관리
 * - Pending choice 저장/조회 (Redis)
 * - 선택 처리 및 라우팅
 */

import { ChoiceRequest, ChoiceResponse, PendingChoice } from './types';
import { TriageResult, ChoiceAction } from '../../agents/common/nodes/triage/types';
import { StateStorePort, PendingChoiceData, PendingChoiceTriageResult } from '../../core/ports/stateStore';

// 기본 만료 시간: 30분
const DEFAULT_EXPIRY_MS = 30 * 60 * 1000;

/**
 * Choice Service Options
 */
export interface ChoiceServiceOptions {
  stateStore: StateStorePort;
}

/**
 * Choice Service
 * Always uses Redis for cross-Pod consistency (unified distributed system).
 */
export class ChoiceService {
  private pendingChoices: Map<string, PendingChoice> = new Map();  // Local cache for hot path
  private stateStore: StateStorePort;
  
  constructor(options: ChoiceServiceOptions) {
    this.stateStore = options.stateStore;
  }
  
  /**
   * Get unique key for a choice
   */
  private getKey(projectId: string, featureName: string): string {
    return `${projectId}:${featureName}`;
  }
  
  /**
   * Convert TriageResult to Redis-storable format
   */
  private toRedisTriageResult(triageResult: TriageResult): PendingChoiceTriageResult {
    return {
      intent: triageResult.intent,
      inScope: triageResult.inScope,
      workStatus: triageResult.workStatus,
      suggestedAgent: triageResult.suggestedAgent,
      suggestedJob: triageResult.suggestedJob,
      redirectReason: triageResult.redirectReason,
      missingPrerequisites: triageResult.missingPrerequisites,
      canProceed: triageResult.canProceed,
      blockedMessage: triageResult.blockedMessage,
      displayMessage: triageResult.displayMessage,
      needsChoice: triageResult.needsChoice,
      choiceOptions: triageResult.choiceOptions
    };
  }
  
  /**
   * Convert Redis format back to TriageResult
   */
  private fromRedisTriageResult(data: PendingChoiceTriageResult): TriageResult {
    return data as TriageResult;
  }
  
  /**
   * Register a pending choice (saves to Redis + local cache)
   */
  async registerPendingChoiceAsync(
    jobId: string,
    projectId: string,
    featureName: string,
    triageResult: TriageResult,
    originalDirective?: string
  ): Promise<void> {
    const key = this.getKey(projectId, featureName);
    const now = Date.now();
    const expiresAt = now + DEFAULT_EXPIRY_MS;
    
    const pendingChoice: PendingChoice = {
      jobId,
      projectId,
      featureName,
      triageResult,
      originalDirective,
      createdAt: now,
      expiresAt
    };
    
    // Save to local cache for immediate access
    this.pendingChoices.set(key, pendingChoice);
    
    // Save to Redis for cross-Pod consistency
    const redisData: PendingChoiceData = {
      jobId,
      projectId,
      featureName,
      triageResult: this.toRedisTriageResult(triageResult),
      originalDirective,
      createdAt: now,
      expiresAt
    };
    await this.stateStore.setPendingChoice(key, redisData);
    
    console.log(`[ChoiceService] Registered pending choice for ${key} (directive: ${originalDirective ? 'yes' : 'no'})`);
  }
  
  /**
   * Sync version — schedules async operation without awaiting
   */
  registerPendingChoice(
    jobId: string,
    projectId: string,
    featureName: string,
    triageResult: TriageResult,
    originalDirective?: string
  ): void {
    // Fire and forget - async operation runs in background
    this.registerPendingChoiceAsync(jobId, projectId, featureName, triageResult, originalDirective)
      .catch(err => console.error(`[ChoiceService] Background save failed:`, err));
  }
  
  /**
   * Get pending choice from Redis (with local cache fallback for hot path)
   */
  async getPendingChoiceAsync(projectId: string, featureName: string): Promise<PendingChoice | undefined> {
    const key = this.getKey(projectId, featureName);
    
    // Try Redis first (source of truth)
    try {
      const redisData = await this.stateStore.getPendingChoice(key);
      if (redisData) {
        const pending: PendingChoice = {
          jobId: redisData.jobId,
          projectId: redisData.projectId,
          featureName: redisData.featureName,
          triageResult: this.fromRedisTriageResult(redisData.triageResult),
          originalDirective: redisData.originalDirective,
          createdAt: redisData.createdAt,
          expiresAt: redisData.expiresAt
        };
        this.pendingChoices.set(key, pending);
        return pending;
      }
    } catch (error) {
      console.error(`[ChoiceService] Failed to load from Redis, trying local cache:`, error);
    }
    
    // Fallback to local cache (hot path optimization)
    const pending = this.pendingChoices.get(key);
    if (!pending) return undefined;
    
    // Check expiry
    if (Date.now() > pending.expiresAt) {
      this.pendingChoices.delete(key);
      return undefined;
    }
    
    return pending;
  }
  
  /**
   * Sync version — returns local cache only (may miss cross-Pod data)
   */
  getPendingChoice(projectId: string, featureName: string): PendingChoice | undefined {
    const key = this.getKey(projectId, featureName);
    const pending = this.pendingChoices.get(key);
    
    if (!pending) return undefined;
    
    // Check expiry
    if (Date.now() > pending.expiresAt) {
      this.pendingChoices.delete(key);
      console.log(`[ChoiceService] Pending choice expired for ${key}`);
      return undefined;
    }
    
    return pending;
  }
  
  /**
   * Clear pending choice from Redis and local cache
   */
  async clearPendingChoiceAsync(projectId: string, featureName: string): Promise<void> {
    const key = this.getKey(projectId, featureName);
    
    this.pendingChoices.delete(key);
    await this.stateStore.deletePendingChoice(key);
    
    console.log(`[ChoiceService] Cleared pending choice for ${key}`);
  }
  
  /**
   * Sync version (fire-and-forget Redis deletion)
   */
  clearPendingChoice(projectId: string, featureName: string): void {
    const key = this.getKey(projectId, featureName);
    this.pendingChoices.delete(key);
    
    this.stateStore.deletePendingChoice(key)
      .catch(err => console.error(`[ChoiceService] Background delete failed:`, err));
  }
  
  /**
   * Handle user choice
   */
  async handleChoice(request: ChoiceRequest): Promise<ChoiceResponse> {
    const pending = await this.getPendingChoiceAsync(request.projectId, request.featureName);
    
    if (!pending) {
      console.log(`[ChoiceService] No pending choice found for ${request.projectId}:${request.featureName}`);
      return {
        type: 'guide',
        message: '선택 대기 항목이 없거나 만료되었습니다. 다시 시도해주세요.'
      };
    }
    
    console.log(`[ChoiceService] Found pending choice for ${request.projectId}:${request.featureName}, processing...`);
    
    const { triageResult } = pending;
    const { choice } = request;
    
    await this.clearPendingChoiceAsync(request.projectId, request.featureName);
    
    // Handle based on choice
    switch (choice) {
      case 'guide':
        return this.handleGuide(triageResult);
        
      case 'proceed':
        return this.handleProceed(triageResult, pending.originalDirective);
        
      case 'proceedAnyway':
        return this.handleProceedAnyway(triageResult, pending.originalDirective);
        
      case 'redirect':
        return this.handleRedirect(triageResult, pending.originalDirective);
      
      case 'dismiss':
        return this.handleDismiss();
        
      default:
        return {
          type: 'guide',
          message: '알 수 없는 선택입니다.'
        };
    }
  }
  
  /**
   * Handle guide choice (negative)
   */
  private handleGuide(triageResult: TriageResult): ChoiceResponse {
    const message = triageResult.choiceOptions?.fallbackGuide || this.generateDefaultGuide(triageResult);
    
    return {
      type: 'guide',
      message
    };
  }
  
  /**
   * Handle proceed choice (continue with current agent/job despite redirect suggestion)
   */
  private handleProceed(triageResult: TriageResult, originalDirective?: string): ChoiceResponse {
    return {
      type: 'continue',
      action: 'proceed',
      directive: originalDirective
    };
  }
  
  /**
   * Handle proceed anyway choice (for blocked with canProceed)
   */
  private handleProceedAnyway(triageResult: TriageResult, originalDirective?: string): ChoiceResponse {
    return {
      type: 'continue',
      action: 'proceedAnyway',
      directive: originalDirective
    };
  }
  
  /**
   * Handle redirect choice
   */
  private handleRedirect(triageResult: TriageResult, originalDirective?: string): ChoiceResponse {
    return {
      type: 'continue',
      action: 'redirect',
      suggestedAgent: triageResult.suggestedAgent,  // ✅ Include target agent (cross-agent redirect)
      suggestedJob: triageResult.suggestedJob,       // ✅ Include target job
      directive: originalDirective                    // ✅ Include original directive
    };
  }
  
  /**
   * Handle dismiss choice (cancel task)
   */
  private handleDismiss(): ChoiceResponse {
    return {
      type: 'dismiss',
      message: '작업이 취소되었습니다. 새 작업을 요청해주세요.'
    };
  }
  
  /**
   * Generate default guide message
   */
  private generateDefaultGuide(triageResult: TriageResult): string {
    const lines: string[] = [];
    
    // Based on workStatus
    if (triageResult.workStatus === 'blocked') {
      lines.push('필요한 준비물을 추가한 후 다시 시도해주세요.');
      
      if (triageResult.missingPrerequisites?.required?.length) {
        lines.push('');
        lines.push('**필수:**');
        triageResult.missingPrerequisites.required.forEach(item => {
          lines.push(`- ${item}`);
        });
      }
      
      if (triageResult.missingPrerequisites?.recommended?.length) {
        lines.push('');
        lines.push('**권장:**');
        triageResult.missingPrerequisites.recommended.forEach(item => {
          lines.push(`- ${item}`);
        });
      }
    } else if (triageResult.workStatus === 'redirect') {
      lines.push(`현재 job에서 가능한 작업:`);
      lines.push('- 작업 범위에 맞는 요청을 입력해주세요.');
    } else {
      lines.push('무엇을 도와드릴까요?');
    }
    
    return lines.join('\n');
  }
  
  /**
   * Cleanup expired choices (call periodically)
   */
  cleanupExpired(): number {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [key, pending] of this.pendingChoices.entries()) {
      if (now > pending.expiresAt) {
        this.pendingChoices.delete(key);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      console.log(`[ChoiceService] Cleaned up ${cleaned} expired choices`);
    }
    
    return cleaned;
  }
}

// NOTE: No singleton export — always construct with { stateStore } from InfrastructureFactory

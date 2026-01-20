/**
 * Choice Service
 * 
 * Triage 결과에 따른 사용자 선택 관리
 * - Pending choice 저장/조회
 * - 선택 처리 및 라우팅
 */

import { ChoiceRequest, ChoiceResponse, PendingChoice } from './types';
import { TriageResult, ChoiceAction } from '../../agents/common/nodes/triage/types';

// 기본 만료 시간: 30분
const DEFAULT_EXPIRY_MS = 30 * 60 * 1000;

/**
 * Choice Service
 */
export class ChoiceService {
  private pendingChoices: Map<string, PendingChoice> = new Map();
  
  /**
   * Get unique key for a choice
   */
  private getKey(projectId: string, featureName: string): string {
    return `${projectId}:${featureName}`;
  }
  
  /**
   * Register a pending choice
   */
  registerPendingChoice(
    jobId: string,
    projectId: string,
    featureName: string,
    triageResult: TriageResult,
    originalDirective?: string  // ✅ For redirect
  ): void {
    const key = this.getKey(projectId, featureName);
    const now = Date.now();
    
    this.pendingChoices.set(key, {
      jobId,
      projectId,
      featureName,
      triageResult,
      originalDirective,  // ✅ Save for redirect
      createdAt: now,
      expiresAt: now + DEFAULT_EXPIRY_MS
    });
    
    console.log(`[ChoiceService] Registered pending choice for ${key} (directive: ${originalDirective ? 'yes' : 'no'})`);
  }
  
  /**
   * Get pending choice
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
   * Clear pending choice
   */
  clearPendingChoice(projectId: string, featureName: string): void {
    const key = this.getKey(projectId, featureName);
    this.pendingChoices.delete(key);
    console.log(`[ChoiceService] Cleared pending choice for ${key}`);
  }
  
  /**
   * Handle user choice
   */
  async handleChoice(request: ChoiceRequest): Promise<ChoiceResponse> {
    const pending = this.getPendingChoice(request.projectId, request.featureName);
    
    if (!pending) {
      return {
        type: 'guide',
        message: '선택 대기 항목이 없거나 만료되었습니다. 다시 시도해주세요.'
      };
    }
    
    const { triageResult } = pending;
    const { choice } = request;
    
    // Clear pending choice
    this.clearPendingChoice(request.projectId, request.featureName);
    
    // Handle based on choice
    switch (choice) {
      case 'guide':
        return this.handleGuide(triageResult);
        
      case 'proceed':
        return this.handleProceed(triageResult);
        
      case 'proceedAnyway':
        return this.handleProceedAnyway(triageResult);
        
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
   * Handle proceed choice
   */
  private handleProceed(triageResult: TriageResult): ChoiceResponse {
    return {
      type: 'continue',
      action: 'proceed'
    };
  }
  
  /**
   * Handle proceed anyway choice (for blocked with canProceed)
   */
  private handleProceedAnyway(triageResult: TriageResult): ChoiceResponse {
    return {
      type: 'continue',
      action: 'proceedAnyway'
    };
  }
  
  /**
   * Handle redirect choice
   */
  private handleRedirect(triageResult: TriageResult, originalDirective?: string): ChoiceResponse {
    return {
      type: 'continue',
      action: 'redirect',
      suggestedJob: triageResult.suggestedJob,  // ✅ Include target job
      directive: originalDirective  // ✅ Include original directive
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

// Export singleton instance
export const choiceService = new ChoiceService();

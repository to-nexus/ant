/**
 * Choice Service — pending choice card lifecycle.
 *
 * Pending choice envelopes are stored in Redis (cross-pod) with a local
 * cache for hot reads. Producers (detect node on `blocked` /
 * `redirect-suggested`) register; the user's pick is routed through
 * `handleChoice` and translated into a `ChoiceResponse` the orchestrator
 * can act on.
 */

import { ChoiceEnvelope, ChoiceRequest, ChoiceResponse, PendingChoice } from './types';
import { StateStorePort, PendingChoiceData, PendingChoiceEnvelope } from '../../core/ports/stateStore';

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
  
  private toRedis(envelope: ChoiceEnvelope): PendingChoiceEnvelope {
    return {
      resolvedIntentId: envelope.resolvedIntentId,
      group: envelope.group,
      mode: envelope.mode,
      domain: envelope.domain,
      displayMessage: envelope.displayMessage,
      suggestedJob: envelope.suggestedJob,
      choiceOptions: envelope.choiceOptions,
    };
  }

  private fromRedis(data: PendingChoiceEnvelope): ChoiceEnvelope {
    return data as ChoiceEnvelope;
  }

  /**
   * Register a pending choice (saves to Redis + local cache)
   */
  async registerPendingChoiceAsync(
    jobId: string,
    projectId: string,
    featureName: string,
    envelope: ChoiceEnvelope,
    originalDirective?: string
  ): Promise<void> {
    const key = this.getKey(projectId, featureName);
    const now = Date.now();
    const expiresAt = now + DEFAULT_EXPIRY_MS;

    const pendingChoice: PendingChoice = {
      jobId,
      projectId,
      featureName,
      envelope,
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
      envelope: this.toRedis(envelope),
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
    envelope: ChoiceEnvelope,
    originalDirective?: string
  ): void {
    this.registerPendingChoiceAsync(jobId, projectId, featureName, envelope, originalDirective)
      .catch(err => console.error(`[ChoiceService] Background save failed:`, err));
  }

  /**
   * Get pending choice from Redis (with local cache fallback for hot path)
   */
  async getPendingChoiceAsync(projectId: string, featureName: string): Promise<PendingChoice | undefined> {
    const key = this.getKey(projectId, featureName);

    try {
      const redisData = await this.stateStore.getPendingChoice(key);
      if (redisData) {
        const pending: PendingChoice = {
          jobId: redisData.jobId,
          projectId: redisData.projectId,
          featureName: redisData.featureName,
          envelope: this.fromRedis(redisData.envelope),
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

    const { envelope } = pending;
    const { choice } = request;

    await this.clearPendingChoiceAsync(request.projectId, request.featureName);

    switch (choice) {
      case 'guide':
        return {
          type: 'guide',
          message: envelope.choiceOptions?.fallbackGuide || envelope.displayMessage || '무엇을 도와드릴까요?',
        };

      case 'proceed':
      case 'proceedAnyway':
        return {
          type: 'continue',
          action: choice,
          directive: pending.originalDirective,
        };

      case 'redirect':
        return {
          type: 'continue',
          action: 'redirect',
          suggestedJob: envelope.suggestedJob,
          directive: pending.originalDirective,
        };

      case 'dismiss':
        return {
          type: 'dismiss',
          message: '작업이 취소되었습니다. 새 작업을 요청해주세요.',
        };

      default:
        return {
          type: 'guide',
          message: '알 수 없는 선택입니다.',
        };
    }
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

/**
 * Pending choices, artifact transfer requests, unseen-artifact tracking and
 * the file-tree cache.
 *
 * One layer of the RedisStateStore inheritance chain (see RedisCoreStore.ts —
 * the chain exists because tests instantiate via Object.create(prototype), so
 * methods must live on the prototype chain, not behind a ctx object).
 */

import type { PendingChoiceData } from '../../../core/ports/stateStore';
import type { TransferRequest } from '../../../core/types/transfer';
import { REDIS_KEYS, REDIS_TTL } from '../redisConstants';
import { logger } from '../../../utils/logger';
import { RedisTurnBufferStore } from './RedisTurnBufferStore';

export class RedisSessionStateStore extends RedisTurnBufferStore {
  // ============================================
  // Pending Choice Management
  // ============================================

  async setPendingChoice(choiceKey: string, choice: PendingChoiceData): Promise<void> {
    // Use dynamic TTL based on expiresAt
    const ttlSeconds = Math.max(1, Math.ceil((choice.expiresAt - Date.now()) / 1000));
    
    await this.redis.setex(
      this.key(REDIS_KEYS.CHOICE.PENDING, choiceKey),
      ttlSeconds,
      JSON.stringify(choice)
    );
    
    logger.debug(`Pending choice stored: ${choiceKey} (TTL: ${ttlSeconds}s)`, { component: 'RedisStateStore' });
  }

  async getPendingChoice(choiceKey: string): Promise<PendingChoiceData | null> {
    const data = await this.redis.get(this.key(REDIS_KEYS.CHOICE.PENDING, choiceKey));
    
    if (!data) return null;
    
    try {
      const choice = JSON.parse(data) as PendingChoiceData;
      
      // Double-check expiry (Redis TTL might be slightly off)
      if (Date.now() > choice.expiresAt) {
        await this.deletePendingChoice(choiceKey);
        return null;
      }
      
      return choice;
    } catch (e) {
      logger.error(`Failed to parse pending choice: ${choiceKey}`, { component: 'RedisStateStore' }, e);
      return null;
    }
  }

  async deletePendingChoice(choiceKey: string): Promise<void> {
    await this.redis.del(this.key(REDIS_KEYS.CHOICE.PENDING, choiceKey));
    logger.debug(`Pending choice deleted: ${choiceKey}`, { component: 'RedisStateStore' });
  }

  // ============================================
  // Transfer Request Management
  // ============================================

  /**
   * Create a transfer request in Redis
   */
  async createTransferRequest(request: TransferRequest): Promise<void> {
    const key = this.key(REDIS_KEYS.TRANSFER.REQUEST, request.id);
    
    await this.redis.setex(
      key,
      REDIS_TTL.TRANSFER.REQUEST,
      JSON.stringify(request)
    );
    
    // Add to recipient index
    const recipientKey = this.key(
      REDIS_KEYS.TRANSFER.BY_RECIPIENT, 
      request.recipient.orgId, 
      request.recipient.userId
    );
    await this.redis.sadd(recipientKey, request.id);
    await this.redis.expire(recipientKey, REDIS_TTL.TRANSFER.REQUEST);
    
    // Add to sender index
    const senderKey = this.key(
      REDIS_KEYS.TRANSFER.BY_SENDER, 
      request.sender.orgId, 
      request.sender.userId
    );
    await this.redis.sadd(senderKey, request.id);
    await this.redis.expire(senderKey, REDIS_TTL.TRANSFER.REQUEST);
    
    logger.debug(`📦 [Transfer] Request created: ${request.id}`, { component: 'RedisStateStore' });
  }

  /**
   * Get a transfer request by ID
   */
  async getTransferRequest(requestId: string): Promise<TransferRequest | null> {
    const data = await this.redis.get(this.key(REDIS_KEYS.TRANSFER.REQUEST, requestId));
    if (!data) return null;
    
    try {
      return JSON.parse(data) as TransferRequest;
    } catch (e) {
      logger.error(`Failed to parse transfer request: ${requestId}`, { component: 'RedisStateStore' }, e);
      return null;
    }
  }

  /**
   * Update transfer request status
   */
  async updateTransferRequestStatus(
    requestId: string, 
    status: TransferRequest['status']
  ): Promise<TransferRequest | null> {
    const request = await this.getTransferRequest(requestId);
    if (!request) return null;
    
    request.status = status;
    
    await this.redis.setex(
      this.key(REDIS_KEYS.TRANSFER.REQUEST, requestId),
      REDIS_TTL.TRANSFER.REQUEST,
      JSON.stringify(request)
    );
    
    logger.debug(`📦 [Transfer] Request ${requestId} status → ${status}`, { component: 'RedisStateStore' });
    return request;
  }

  /**
   * Get all transfer requests for a recipient (pending or all)
   */
  async getTransferRequestsByRecipient(
    orgId: string, 
    userId: string, 
    statusFilter?: TransferRequest['status']
  ): Promise<TransferRequest[]> {
    const recipientKey = this.key(REDIS_KEYS.TRANSFER.BY_RECIPIENT, orgId, userId);
    const requestIds = await this.redis.smembers(recipientKey);
    
    if (requestIds.length === 0) return [];
    
    const pipeline = this.redis.pipeline();
    for (const id of requestIds) {
      pipeline.get(this.key(REDIS_KEYS.TRANSFER.REQUEST, id));
    }
    const results = await pipeline.exec();
    
    const requests: TransferRequest[] = [];
    const expiredIds: string[] = [];
    
    for (let i = 0; i < requestIds.length; i++) {
      const [err, data] = results![i];
      if (err || !data) {
        // Request expired from Redis, clean up index
        expiredIds.push(requestIds[i]);
        continue;
      }
      try {
        const request = JSON.parse(data as string) as TransferRequest;
        if (!statusFilter || request.status === statusFilter) {
          requests.push(request);
        }
      } catch {
        expiredIds.push(requestIds[i]);
      }
    }
    
    // Cleanup stale index entries
    if (expiredIds.length > 0) {
      await this.redis.srem(recipientKey, ...expiredIds);
    }
    
    return requests;
  }

  /**
   * Get all transfer requests sent by a user
   */
  async getTransferRequestsBySender(
    orgId: string, 
    userId: string, 
    statusFilter?: TransferRequest['status']
  ): Promise<TransferRequest[]> {
    const senderKey = this.key(REDIS_KEYS.TRANSFER.BY_SENDER, orgId, userId);
    const requestIds = await this.redis.smembers(senderKey);
    
    if (requestIds.length === 0) return [];
    
    const pipeline = this.redis.pipeline();
    for (const id of requestIds) {
      pipeline.get(this.key(REDIS_KEYS.TRANSFER.REQUEST, id));
    }
    const results = await pipeline.exec();
    
    const requests: TransferRequest[] = [];
    const expiredIds: string[] = [];
    
    for (let i = 0; i < requestIds.length; i++) {
      const [err, data] = results![i];
      if (err || !data) {
        expiredIds.push(requestIds[i]);
        continue;
      }
      try {
        const request = JSON.parse(data as string) as TransferRequest;
        if (!statusFilter || request.status === statusFilter) {
          requests.push(request);
        }
      } catch {
        expiredIds.push(requestIds[i]);
      }
    }
    
    if (expiredIds.length > 0) {
      await this.redis.srem(senderKey, ...expiredIds);
    }
    
    return requests;
  }

  /**
   * Delete a transfer request and remove from indexes
   */
  async deleteTransferRequest(requestId: string): Promise<void> {
    const request = await this.getTransferRequest(requestId);
    if (!request) return;
    
    // Remove from indexes
    const recipientKey = this.key(
      REDIS_KEYS.TRANSFER.BY_RECIPIENT, 
      request.recipient.orgId, 
      request.recipient.userId
    );
    const senderKey = this.key(
      REDIS_KEYS.TRANSFER.BY_SENDER, 
      request.sender.orgId, 
      request.sender.userId
    );
    
    await Promise.all([
      this.redis.del(this.key(REDIS_KEYS.TRANSFER.REQUEST, requestId)),
      this.redis.srem(recipientKey, requestId),
      this.redis.srem(senderKey, requestId),
    ]);
    
    logger.debug(`📦 [Transfer] Request deleted: ${requestId}`, { component: 'RedisStateStore' });
  }

  /**
   * Count pending transfer requests for a recipient (for badge)
   */
  async countPendingTransferRequests(orgId: string, userId: string): Promise<number> {
    const requests = await this.getTransferRequestsByRecipient(orgId, userId, 'pending');
    return requests.length;
  }

  // ============================================
  // Unseen Artifacts Management
  // ============================================

  async addUnseenArtifacts(userId: string, projectId: string, feature: string, paths: string[]): Promise<void> {
    if (paths.length === 0) return;
    const key = this.key(REDIS_KEYS.ARTIFACTS.UNSEEN, `${userId}:${projectId}:${feature}`);
    const pipeline = this.redis.pipeline();
    pipeline.sadd(key, ...paths);
    pipeline.expire(key, REDIS_TTL.ARTIFACTS.UNSEEN);
    await pipeline.exec();
    logger.debug(`Unseen artifacts added: ${paths.length} paths for ${projectId}/${feature}`, { component: 'RedisStateStore' });
  }

  async removeUnseenArtifacts(userId: string, projectId: string, feature: string, paths: string[]): Promise<void> {
    if (paths.length === 0) return;
    const key = this.key(REDIS_KEYS.ARTIFACTS.UNSEEN, `${userId}:${projectId}:${feature}`);
    await this.redis.srem(key, ...paths);
    logger.debug(`Unseen artifacts removed: ${paths.length} paths for ${projectId}/${feature}`, { component: 'RedisStateStore' });
  }

  async getUnseenArtifacts(userId: string, projectId: string, feature: string): Promise<string[]> {
    const key = this.key(REDIS_KEYS.ARTIFACTS.UNSEEN, `${userId}:${projectId}:${feature}`);
    return this.redis.smembers(key);
  }

  async clearUnseenArtifacts(userId: string, projectId: string, feature: string): Promise<void> {
    const key = this.key(REDIS_KEYS.ARTIFACTS.UNSEEN, `${userId}:${projectId}:${feature}`);
    await this.redis.del(key);
    logger.debug(`Unseen artifacts cleared for ${projectId}/${feature}`, { component: 'RedisStateStore' });
  }

  // ============================================
  // FileTree Cache
  // ============================================

  async setFileTreeCache(userId: string, projectId: string, feature: string, tree: any[]): Promise<void> {
    const key = this.key(REDIS_KEYS.ARTIFACTS.FILETREE, `${userId}:${projectId}:${feature}`);
    await this.redis.set(key, JSON.stringify(tree), 'EX', REDIS_TTL.ARTIFACTS.FILETREE);
    logger.debug(`FileTree cache set for ${projectId}/${feature}`, { component: 'RedisStateStore' });
  }

  async getFileTreeCache(userId: string, projectId: string, feature: string): Promise<any[] | null> {
    const key = this.key(REDIS_KEYS.ARTIFACTS.FILETREE, `${userId}:${projectId}:${feature}`);
    const data = await this.redis.get(key);
    return data ? JSON.parse(data) : null;
  }

}

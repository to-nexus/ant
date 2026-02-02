/**
 * RedisPortRegistry
 * 
 * Redis-based implementation of PortRegistryPort.
 * Suitable for production multi-server deployments.
 * 
 * Advantages:
 * - Persistent across server restarts
 * - Shared across multiple server instances
 * - Scalable
 * 
 * Requirements:
 * - Redis server
 */

// NOTE: ioredis not installed - this file is not currently used (InMemoryPortRegistry is used instead)
// import Redis from 'ioredis';
import { PortRegistryPort, PortMapping } from '../../core/ports/portRegistry';

export class RedisPortRegistry implements PortRegistryPort {
  private redis: any;  // Redis type when ioredis is installed
  
  constructor(redisUrl?: string) {
    // NOTE: Requires 'ioredis' package to be installed
    // this.redis = new Redis(redisUrl || 'redis://localhost:6379');
    throw new Error('RedisPortRegistry requires ioredis package. Use InMemoryPortRegistry instead.');
  }
  
  /**
   * Create storage key from identifiers (for Preview - includes feature)
   */
  private createKey(tenantId: string, userId: string, projectId: string, feature: string): string {
    return `${tenantId}:${userId}:${projectId}:${feature}`;
  }

  /**
   * Create IDE storage key (no feature - IDE is project-level)
   */
  private createIDEKey(tenantId: string, userId: string, projectId: string): string {
    return `${tenantId}:${userId}:${projectId}`;
  }
  
  /**
   * Register preview port
   */
  async registerPreview(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string,
    port: number,
    host: string = 'localhost'
  ): Promise<void> {
    const key = this.createKey(tenantId, userId, projectId, feature);
    const mapping: PortMapping & { host: string } = {
      tenantId,
      userId,
      projectId,
      feature,
      port,
      host,
      registeredAt: new Date(),
      lastAccessedAt: new Date()
    };
    
    await this.redis.hset('previews', key, JSON.stringify(mapping));
    console.log(`[RedisPortRegistry] Registered preview: ${key} → ${host}:${port}`);
  }
  
  /**
   * Register IDE port (IDE is project-level, no feature)
   */
  async registerIDE(
    tenantId: string,
    userId: string,
    projectId: string,
    port: number
  ): Promise<void> {
    const key = this.createIDEKey(tenantId, userId, projectId);
    const mapping: PortMapping = {
      tenantId,
      userId,
      projectId,
      feature: 'main',  // Stored for compatibility
      port,
      registeredAt: new Date(),
      lastAccessedAt: new Date()
    };
    
    await this.redis.hset('ides', key, JSON.stringify(mapping));
    console.log(`[RedisPortRegistry] Registered IDE: ${key} → ${port}`);
  }
  
  /**
   * Get preview port
   */
  async getPreviewPort(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string
  ): Promise<number | null> {
    const mapping = await this.getPreview(tenantId, userId, projectId, feature);
    return mapping?.port ?? null;
  }

  /**
   * Get preview mapping (includes host)
   */
  async getPreview(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string
  ): Promise<PortMapping | null> {
    const key = this.createKey(tenantId, userId, projectId, feature);
    const data = await this.redis.hget('previews', key);
    
    if (!data) {
      return null;
    }
    
    const mapping: PortMapping = JSON.parse(data);
    
    // Update last access time
    mapping.lastAccessedAt = new Date();
    await this.redis.hset('previews', key, JSON.stringify(mapping));
    
    return mapping;
  }
  
  /**
   * Get IDE port (IDE is project-level, no feature)
   */
  async getIDEPort(
    tenantId: string,
    userId: string,
    projectId: string
  ): Promise<number | null> {
    const key = this.createIDEKey(tenantId, userId, projectId);
    const data = await this.redis.hget('ides', key);
    
    if (!data) {
      return null;
    }
    
    const mapping: PortMapping = JSON.parse(data);
    
    // Update last access time
    mapping.lastAccessedAt = new Date();
    await this.redis.hset('ides', key, JSON.stringify(mapping));
    
    return mapping.port;
  }
  
  /**
   * Unregister preview
   */
  async unregisterPreview(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string
  ): Promise<void> {
    const key = this.createKey(tenantId, userId, projectId, feature);
    await this.redis.hdel('previews', key);
    console.log(`[RedisPortRegistry] Unregistered preview: ${key}`);
  }
  
  /**
   * Unregister IDE (IDE is project-level, no feature)
   */
  async unregisterIDE(
    tenantId: string,
    userId: string,
    projectId: string
  ): Promise<void> {
    const key = this.createIDEKey(tenantId, userId, projectId);
    await this.redis.hdel('ides', key);
    console.log(`[RedisPortRegistry] Unregistered IDE: ${key}`);
  }
  
  /**
   * List all previews
   */
  async listPreviews(): Promise<PortMapping[]> {
    const entries = await this.redis.hgetall('previews');
    const result: PortMapping[] = [];
    
    for (const [, data] of Object.entries(entries)) {
      result.push(JSON.parse(data as string));
    }
    
    return result;
  }
  
  /**
   * List all IDEs
   */
  async listIDEs(): Promise<PortMapping[]> {
    const entries = await this.redis.hgetall('ides');
    const result: PortMapping[] = [];
    
    for (const [, data] of Object.entries(entries)) {
      result.push(JSON.parse(data as string));
    }
    
    return result;
  }
  
  /**
   * Update last accessed time
   */
  async updateLastAccess(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string,
    type: 'preview' | 'ide'
  ): Promise<void> {
    // IDE uses project-level key (no feature), Preview uses feature
    const key = type === 'ide'
      ? this.createIDEKey(tenantId, userId, projectId)
      : this.createKey(tenantId, userId, projectId, feature);
    const hashKey = type === 'preview' ? 'previews' : 'ides';
    const data = await this.redis.hget(hashKey, key);
    
    if (data) {
      const mapping: PortMapping = JSON.parse(data);
      mapping.lastAccessedAt = new Date();
      await this.redis.hset(hashKey, key, JSON.stringify(mapping));
    }
  }
  
  /**
   * Close Redis connection
   */
  async close(): Promise<void> {
    await this.redis.quit();
    console.log('[RedisPortRegistry] Closed Redis connection');
  }
}

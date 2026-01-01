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
   * Create storage key from identifiers
   */
  private createKey(tenantId: string, userId: string, projectId: string, feature: string): string {
    return `${tenantId}:${userId}:${projectId}:${feature}`;
  }
  
  /**
   * Register dev server port
   */
  async registerDevServer(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string,
    port: number
  ): Promise<void> {
    const key = this.createKey(tenantId, userId, projectId, feature);
    const mapping: PortMapping = {
      tenantId,
      userId,
      projectId,
      feature,
      port,
      registeredAt: new Date(),
      lastAccessedAt: new Date()
    };
    
    await this.redis.hset('dev-servers', key, JSON.stringify(mapping));
    console.log(`[RedisPortRegistry] Registered dev server: ${key} → ${port}`);
  }
  
  /**
   * Register IDE port
   */
  async registerIDE(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string,
    port: number
  ): Promise<void> {
    const key = this.createKey(tenantId, userId, projectId, feature);
    const mapping: PortMapping = {
      tenantId,
      userId,
      projectId,
      feature,
      port,
      registeredAt: new Date(),
      lastAccessedAt: new Date()
    };
    
    await this.redis.hset('ides', key, JSON.stringify(mapping));
    console.log(`[RedisPortRegistry] Registered IDE: ${key} → ${port}`);
  }
  
  /**
   * Get dev server port
   */
  async getDevServerPort(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string
  ): Promise<number | null> {
    const key = this.createKey(tenantId, userId, projectId, feature);
    const data = await this.redis.hget('dev-servers', key);
    
    if (!data) {
      return null;
    }
    
    const mapping: PortMapping = JSON.parse(data);
    
    // Update last access time
    mapping.lastAccessedAt = new Date();
    await this.redis.hset('dev-servers', key, JSON.stringify(mapping));
    
    return mapping.port;
  }
  
  /**
   * Get IDE port
   */
  async getIDEPort(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string
  ): Promise<number | null> {
    const key = this.createKey(tenantId, userId, projectId, feature);
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
   * Unregister dev server
   */
  async unregisterDevServer(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string
  ): Promise<void> {
    const key = this.createKey(tenantId, userId, projectId, feature);
    await this.redis.hdel('dev-servers', key);
    console.log(`[RedisPortRegistry] Unregistered dev server: ${key}`);
  }
  
  /**
   * Unregister IDE
   */
  async unregisterIDE(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string
  ): Promise<void> {
    const key = this.createKey(tenantId, userId, projectId, feature);
    await this.redis.hdel('ides', key);
    console.log(`[RedisPortRegistry] Unregistered IDE: ${key}`);
  }
  
  /**
   * List all dev servers
   */
  async listDevServers(): Promise<PortMapping[]> {
    const entries = await this.redis.hgetall('dev-servers');
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
    type: 'dev-server' | 'ide'
  ): Promise<void> {
    const key = this.createKey(tenantId, userId, projectId, feature);
    const hashKey = type === 'dev-server' ? 'dev-servers' : 'ides';
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



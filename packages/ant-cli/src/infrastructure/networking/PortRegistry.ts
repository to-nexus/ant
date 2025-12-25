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

import Redis from 'ioredis';
import { PortRegistryPort, PortMapping } from '../../core/ports/portRegistry';

export class RedisPortRegistry implements PortRegistryPort {
  private redis: Redis;
  
  constructor(redisUrl?: string) {
    this.redis = new Redis(redisUrl || 'redis://localhost:6379');
    console.log('[RedisPortRegistry] Connected to Redis');
  }
  
  /**
   * Create storage key from identifiers
   */
  private createKey(tenantId: string, projectId: string, feature: string): string {
    return `${tenantId}:${projectId}:${feature}`;
  }
  
  /**
   * Register dev server port
   */
  async registerDevServer(
    tenantId: string, 
    projectId: string,
    feature: string,
    port: number
  ): Promise<void> {
    const key = this.createKey(tenantId, projectId, feature);
    const mapping: PortMapping = {
      tenantId,
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
    projectId: string,
    feature: string,
    port: number
  ): Promise<void> {
    const key = this.createKey(tenantId, projectId, feature);
    const mapping: PortMapping = {
      tenantId,
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
    projectId: string,
    feature: string
  ): Promise<number | null> {
    const key = this.createKey(tenantId, projectId, feature);
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
    projectId: string,
    feature: string
  ): Promise<number | null> {
    const key = this.createKey(tenantId, projectId, feature);
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
    projectId: string,
    feature: string
  ): Promise<void> {
    const key = this.createKey(tenantId, projectId, feature);
    await this.redis.hdel('dev-servers', key);
    console.log(`[RedisPortRegistry] Unregistered dev server: ${key}`);
  }
  
  /**
   * Unregister IDE
   */
  async unregisterIDE(
    tenantId: string,
    projectId: string,
    feature: string
  ): Promise<void> {
    const key = this.createKey(tenantId, projectId, feature);
    await this.redis.hdel('ides', key);
    console.log(`[RedisPortRegistry] Unregistered IDE: ${key}`);
  }
  
  /**
   * List all dev servers
   */
  async listDevServers(): Promise<PortMapping[]> {
    const entries = await this.redis.hgetall('dev-servers');
    const result: PortMapping[] = [];
    
    for (const [key, data] of Object.entries(entries)) {
      result.push(JSON.parse(data));
    }
    
    return result;
  }
  
  /**
   * List all IDEs
   */
  async listIDEs(): Promise<PortMapping[]> {
    const entries = await this.redis.hgetall('ides');
    const result: PortMapping[] = [];
    
    for (const [key, data] of Object.entries(entries)) {
      result.push(JSON.parse(data));
    }
    
    return result;
  }
  
  /**
   * Update last accessed time
   */
  async updateLastAccess(
    tenantId: string,
    projectId: string,
    feature: string,
    type: 'dev-server' | 'ide'
  ): Promise<void> {
    const key = this.createKey(tenantId, projectId, feature);
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



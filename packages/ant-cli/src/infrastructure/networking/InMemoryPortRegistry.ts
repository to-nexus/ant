/**
 * InMemoryPortRegistry
 * 
 * In-memory implementation of PortRegistryPort.
 * Suitable for single-server deployments and local development.
 * 
 * Limitations:
 * - Data lost on server restart
 * - Cannot be shared across multiple server instances
 * - No persistence
 * 
 * Advantages:
 * - Simple and fast
 * - No external dependencies
 * - Easy to debug
 */

import { PortRegistryPort, PortMapping } from '../../core/ports/portRegistry';

export class InMemoryPortRegistry implements PortRegistryPort {
  private devServers = new Map<string, PortMapping>();
  private ides = new Map<string, PortMapping>();

  /**
   * Create storage key from identifiers
   * Format: tenantId:userId:projectId:feature
   */
  private createKey(tenantId: string, userId: string, projectId: string, feature: string): string {
    return `${tenantId}:${userId}:${projectId}:${feature}`;
  }

  /**
   * Register dev server port mapping
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

    this.devServers.set(key, mapping);
    console.log(`[InMemoryPortRegistry] Registered dev server: ${key} → ${port}`);
  }

  /**
   * Register IDE port mapping
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

    this.ides.set(key, mapping);
    console.log(`[InMemoryPortRegistry] Registered IDE: ${key} → ${port}`);
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
    const mapping = this.devServers.get(key);

    if (mapping) {
      // Update last access time
      mapping.lastAccessedAt = new Date();
      return mapping.port;
    }

    return null;
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
    const mapping = this.ides.get(key);

    if (mapping) {
      mapping.lastAccessedAt = new Date();
      return mapping.port;
    }

    return null;
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
    const deleted = this.devServers.delete(key);

    if (deleted) {
      console.log(`[InMemoryPortRegistry] Unregistered dev server: ${key}`);
    }
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
    const deleted = this.ides.delete(key);

    if (deleted) {
      console.log(`[InMemoryPortRegistry] Unregistered IDE: ${key}`);
    }
  }

  /**
   * List all active dev servers
   */
  async listDevServers(): Promise<PortMapping[]> {
    return Array.from(this.devServers.values());
  }

  /**
   * List all active IDEs
   */
  async listIDEs(): Promise<PortMapping[]> {
    return Array.from(this.ides.values());
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
    const map = type === 'dev-server' ? this.devServers : this.ides;
    const mapping = map.get(key);

    if (mapping) {
      mapping.lastAccessedAt = new Date();
    }
  }

  /**
   * Get statistics
   */
  getStats(): {
    devServers: number;
    ides: number;
    total: number;
  } {
    return {
      devServers: this.devServers.size,
      ides: this.ides.size,
      total: this.devServers.size + this.ides.size
    };
  }

  /**
   * Cleanup (no-op for in-memory)
   */
  async close(): Promise<void> {
    console.log('[InMemoryPortRegistry] Closing (no-op for in-memory)');
  }

  /**
   * Clear all data (useful for testing)
   */
  clear(): void {
    this.devServers.clear();
    this.ides.clear();
    console.log('[InMemoryPortRegistry] Cleared all data');
  }
}


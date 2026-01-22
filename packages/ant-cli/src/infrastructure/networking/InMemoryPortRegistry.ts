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
  private previews = new Map<string, PortMapping>();
  private ides = new Map<string, PortMapping>();

  /**
   * Create storage key from identifiers
   * Format: tenantId:userId:projectId:feature
   */
  private createKey(tenantId: string, userId: string, projectId: string, feature: string): string {
    return `${tenantId}:${userId}:${projectId}:${feature}`;
  }

  /**
   * Register preview port mapping
   */
  async registerPreview(
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

    this.previews.set(key, mapping);
    console.log(`[InMemoryPortRegistry] Registered preview: ${key} → ${port}`);
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
   * Get preview port
   */
  async getPreviewPort(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string
  ): Promise<number | null> {
    const key = this.createKey(tenantId, userId, projectId, feature);
    const mapping = this.previews.get(key);

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
   * Unregister preview
   */
  async unregisterPreview(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string
  ): Promise<void> {
    const key = this.createKey(tenantId, userId, projectId, feature);
    const deleted = this.previews.delete(key);

    if (deleted) {
      console.log(`[InMemoryPortRegistry] Unregistered preview: ${key}`);
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
   * List all active previews
   */
  async listPreviews(): Promise<PortMapping[]> {
    return Array.from(this.previews.values());
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
    type: 'preview' | 'ide'
  ): Promise<void> {
    const key = this.createKey(tenantId, userId, projectId, feature);
    const map = type === 'preview' ? this.previews : this.ides;
    const mapping = map.get(key);

    if (mapping) {
      mapping.lastAccessedAt = new Date();
    }
  }

  /**
   * Get statistics
   */
  getStats(): {
    previews: number;
    ides: number;
    total: number;
  } {
    return {
      previews: this.previews.size,
      ides: this.ides.size,
      total: this.previews.size + this.ides.size
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
    this.previews.clear();
    this.ides.clear();
    console.log('[InMemoryPortRegistry] Cleared all data');
  }
}

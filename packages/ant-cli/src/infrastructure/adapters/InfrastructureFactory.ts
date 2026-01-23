/**
 * InfrastructureFactory
 * 
 * Factory for creating cloud-scalable infrastructure adapters.
 * 
 * Configuration is derived from a SINGLE environment variable:
 * - ANT_SERVER_MODE: 'local' | 'cloud' (default: 'local')
 * 
 * Mode Mapping:
 * - local: All local/single-machine implementations
 *   - StateStore: LocalStateStore (in-memory)
 *   - JobQueue: LocalJobQueue (direct spawn)
 *   - Preview: LocalPreviewOrchestrator (local npm processes)
 *   - IDE: LocalIDEOrchestrator (local Docker)
 * 
 * - cloud: All cloud/distributed implementations
 *   - StateStore: RedisStateStore
 *   - JobQueue: BullMQJobQueue (Redis-based)
 *   - Preview: RemotePreviewOrchestrator (worker nodes)
 *   - IDE: KubernetesIDEOrchestrator (K8s pods)
 * 
 * Additional environment variables (for cloud mode only):
 * - ANT_REDIS_URL: Redis connection URL (required for cloud mode)
 * - ANT_PREVIEW_WORKERS: Comma-separated list of preview worker hosts
 * - ANT_K8S_NAMESPACE: Kubernetes namespace for IDE pods
 * 
 * @see 10-cloud-scalability-design.md Section 6.2
 */

import { StateStorePort } from '../../core/ports/stateStore';
import { JobQueuePort } from '../../core/ports/queue';
import { PreviewOrchestratorPort } from '../../core/ports/previewOrchestrator';
import { IDEOrchestratorPort } from '../../core/ports/ideOrchestrator';
import { PortRegistryPort } from '../../core/ports/portRegistry';

import { LocalStateStore } from '../state/LocalStateStore';
import { RedisStateStore } from '../state/RedisStateStore';
import { LocalJobQueue } from '../queue/LocalJobQueue';
import { BullMQJobQueue } from '../queue/BullMQJobQueue';
import { LocalPreviewOrchestrator } from '../preview/LocalPreviewOrchestrator';
import { RemotePreviewOrchestrator } from '../preview/RemotePreviewOrchestrator';
import { LocalIDEOrchestrator } from '../ide/LocalIDEOrchestrator';
import { KubernetesIDEOrchestrator } from '../ide/KubernetesIDEOrchestrator';
import { PortManager } from '../networking/PortManager';

import { logger } from '../../utils/logger';

// ============================================
// Environment Configuration
// ============================================

export type ServerMode = 'local' | 'cloud';

export interface InfrastructureConfig {
  serverMode: ServerMode;
  
  // Cloud mode specific
  redisUrl?: string;
  previewWorkers?: string[];
  k8sNamespace?: string;
}

// ============================================
// InfrastructureFactory
// ============================================

export class InfrastructureFactory {
  private static instance: InfrastructureFactory;
  
  // Singleton instances
  private stateStore: StateStorePort | null = null;
  private jobQueue: JobQueuePort | null = null;
  private previewOrchestrator: PreviewOrchestratorPort | null = null;
  private ideOrchestrator: IDEOrchestratorPort | null = null;
  
  // Dependencies (must be set before getting orchestrators)
  private portManager: PortManager | null = null;
  private portRegistry: PortRegistryPort | null = null;
  
  private config: InfrastructureConfig;

  private constructor() {
    this.config = this.loadConfig();
    logger.info(`InfrastructureFactory initialized with mode: ${this.config.serverMode}`, { 
      component: 'InfrastructureFactory' 
    });
  }

  /**
   * Get singleton instance
   */
  static getInstance(): InfrastructureFactory {
    if (!InfrastructureFactory.instance) {
      InfrastructureFactory.instance = new InfrastructureFactory();
    }
    return InfrastructureFactory.instance;
  }

  /**
   * Load configuration from environment
   * Only ANT_SERVER_MODE determines local vs cloud stack
   */
  private loadConfig(): InfrastructureConfig {
    const serverMode = (process.env.ANT_SERVER_MODE || 'local') as ServerMode;
    
    return {
      serverMode,
      // Cloud-specific settings (only used when serverMode === 'cloud')
      redisUrl: process.env.ANT_REDIS_URL,
      previewWorkers: process.env.ANT_PREVIEW_WORKERS?.split(',').filter(Boolean),
      k8sNamespace: process.env.ANT_K8S_NAMESPACE || 'ant-ide'
    };
  }
  
  /**
   * Check if running in cloud mode
   */
  isCloudMode(): boolean {
    return this.config.serverMode === 'cloud';
  }

  /**
   * Get configuration
   */
  getConfig(): InfrastructureConfig {
    return { ...this.config };
  }

  /**
   * Set dependencies (required for orchestrators)
   */
  setDependencies(portManager: PortManager, portRegistry: PortRegistryPort): void {
    this.portManager = portManager;
    this.portRegistry = portRegistry;
  }

  // ============================================
  // State Store
  // ============================================

  /**
   * Get StateStorePort implementation
   * - local: LocalStateStore (in-memory)
   * - cloud: RedisStateStore (Redis-based)
   */
  getStateStore(): StateStorePort {
    if (!this.stateStore) {
      if (this.isCloudMode()) {
        if (!this.config.redisUrl) {
          throw new Error('ANT_REDIS_URL is required for cloud mode');
        }
        this.stateStore = new RedisStateStore({ url: this.config.redisUrl });
        logger.info('Using RedisStateStore for cloud mode', {
          component: 'InfrastructureFactory'
        });
      } else {
        this.stateStore = new LocalStateStore();
        logger.debug('Using LocalStateStore for local mode', {
          component: 'InfrastructureFactory'
        });
      }
    }
    
    return this.stateStore;
  }

  // ============================================
  // Job Queue
  // ============================================

  /**
   * Get JobQueuePort implementation
   * - local: LocalJobQueue (direct spawn)
   * - cloud: BullMQJobQueue (Redis-based, requires separate worker)
   */
  getJobQueue(): JobQueuePort {
    if (!this.jobQueue) {
      if (this.isCloudMode()) {
        if (!this.config.redisUrl) {
          throw new Error('ANT_REDIS_URL is required for cloud mode');
        }
        this.jobQueue = new BullMQJobQueue(
          { redisUrl: this.config.redisUrl },
          this.getStateStore()
        );
        logger.info('Using BullMQJobQueue for cloud mode', {
          component: 'InfrastructureFactory'
        });
      } else {
        this.jobQueue = new LocalJobQueue(this.getStateStore());
        logger.debug('Using LocalJobQueue for local mode', {
          component: 'InfrastructureFactory'
        });
      }
    }
    
    return this.jobQueue;
  }

  // ============================================
  // Preview Orchestrator
  // ============================================

  /**
   * Get PreviewOrchestratorPort implementation
   * - local: LocalPreviewOrchestrator (local npm processes)
   * - cloud: RemotePreviewOrchestrator (remote workers)
   */
  getPreviewOrchestrator(): PreviewOrchestratorPort {
    if (!this.portManager || !this.portRegistry) {
      throw new Error('Dependencies not set. Call setDependencies() first.');
    }
    
    if (!this.previewOrchestrator) {
      if (this.isCloudMode()) {
        if (this.config.previewWorkers && this.config.previewWorkers.length > 0) {
          this.previewOrchestrator = new RemotePreviewOrchestrator(
            { workers: this.config.previewWorkers },
            this.getStateStore()
          );
          logger.info('Using RemotePreviewOrchestrator for cloud mode', {
            component: 'InfrastructureFactory'
          });
        } else {
          // No workers configured, fall back to local
          logger.warn('No preview workers configured, falling back to Local', {
            component: 'InfrastructureFactory'
          });
          this.previewOrchestrator = new LocalPreviewOrchestrator(
            this.portManager,
            this.portRegistry
          );
        }
      } else {
        this.previewOrchestrator = new LocalPreviewOrchestrator(
          this.portManager,
          this.portRegistry
        );
        logger.debug('Using LocalPreviewOrchestrator for local mode', {
          component: 'InfrastructureFactory'
        });
      }
    }
    
    return this.previewOrchestrator;
  }

  // ============================================
  // IDE Orchestrator
  // ============================================

  /**
   * Get IDEOrchestratorPort implementation
   * - local: LocalIDEOrchestrator (local Docker)
   * - cloud: KubernetesIDEOrchestrator (K8s pods)
   */
  getIDEOrchestrator(): IDEOrchestratorPort {
    if (!this.portManager || !this.portRegistry) {
      throw new Error('Dependencies not set. Call setDependencies() first.');
    }
    
    if (!this.ideOrchestrator) {
      if (this.isCloudMode()) {
        this.ideOrchestrator = new KubernetesIDEOrchestrator(
          { namespace: this.config.k8sNamespace },
          this.getStateStore()
        );
        logger.info('Using KubernetesIDEOrchestrator for cloud mode', {
          component: 'InfrastructureFactory'
        });
      } else {
        this.ideOrchestrator = new LocalIDEOrchestrator(
          this.portManager,
          this.portRegistry
        );
        logger.debug('Using LocalIDEOrchestrator for local mode', {
          component: 'InfrastructureFactory'
        });
      }
    }
    
    return this.ideOrchestrator;
  }

  // ============================================
  // Lifecycle
  // ============================================

  /**
   * Cleanup all adapters
   */
  async cleanup(): Promise<void> {
    logger.info('Cleaning up all infrastructure adapters', { component: 'InfrastructureFactory' });
    
    try {
      if (this.previewOrchestrator) {
        await this.previewOrchestrator.cleanup();
      }
    } catch (error) {
      logger.error('Error cleaning up PreviewOrchestrator', { component: 'InfrastructureFactory' }, error);
    }
    
    try {
      if (this.ideOrchestrator) {
        await this.ideOrchestrator.cleanup();
      }
    } catch (error) {
      logger.error('Error cleaning up IDEOrchestrator', { component: 'InfrastructureFactory' }, error);
    }
    
    try {
      if (this.jobQueue) {
        await this.jobQueue.close();
      }
    } catch (error) {
      logger.error('Error closing JobQueue', { component: 'InfrastructureFactory' }, error);
    }
    
    try {
      if (this.stateStore) {
        await this.stateStore.close();
      }
    } catch (error) {
      logger.error('Error closing StateStore', { component: 'InfrastructureFactory' }, error);
    }
    
    // Reset instances
    this.stateStore = null;
    this.jobQueue = null;
    this.previewOrchestrator = null;
    this.ideOrchestrator = null;
  }

  /**
   * Reset factory (for testing)
   */
  static reset(): void {
    if (InfrastructureFactory.instance) {
      // Don't await cleanup in reset
      InfrastructureFactory.instance.cleanup().catch(() => {});
      InfrastructureFactory.instance = null as any;
    }
  }
}

// ============================================
// Convenience exports
// ============================================

/**
 * Get the global InfrastructureFactory instance
 */
export function getInfrastructureFactory(): InfrastructureFactory {
  return InfrastructureFactory.getInstance();
}

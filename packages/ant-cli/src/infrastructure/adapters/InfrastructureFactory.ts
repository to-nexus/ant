/**
 * InfrastructureFactory
 * 
 * Factory for creating infrastructure adapters.
 * 
 * All environments (local and cloud) use the same distributed architecture:
 * - StateStore: RedisStateStore (required)
 * - JobQueue: BullMQJobQueue (Redis-based, required)
 * - Preview: RemotePreviewOrchestrator (worker-based, required)
 * - IDE: LocalIDEOrchestrator (Docker) or KubernetesIDEOrchestrator (K8s)
 * 
 * Environment Variables:
 * - ANT_SERVER_MODE: 'local' | 'cloud' (affects authentication only)
 * - ANT_REDIS_URL: Redis connection URL (REQUIRED)
 * - ANT_PREVIEW_WORKERS: Comma-separated list of preview worker URLs (REQUIRED)
 * - ANT_K8S_NAMESPACE: Kubernetes namespace for IDE pods (optional, uses Docker if not set)
 * 
 * The only difference between local and cloud:
 * - local: Uses local:local for authentication (no real auth)
 * - cloud: Requires explicit authentication (OAuth, etc.)
 * 
 * @see 10-cloud-scalability-design.md Section 6.2
 */

import { StateStorePort } from '../../core/ports/stateStore';
import { JobQueuePort } from '../../core/ports/queue';
import { PreviewOrchestratorPort } from '../../core/ports/previewOrchestrator';
import { IDEOrchestratorPort } from '../../core/ports/ideOrchestrator';
import { PortRegistryPort } from '../../core/ports/portRegistry';

import { RedisStateStore } from '../state/RedisStateStore';
import { BullMQJobQueue } from '../queue/BullMQJobQueue';
import { RemotePreviewOrchestrator } from '../preview/RemotePreviewOrchestrator';
import { LocalIDEOrchestrator } from '../ide/LocalIDEOrchestrator';
import { KubernetesIDEOrchestrator } from '../ide/KubernetesIDEOrchestrator';
import { PortManager } from '../networking/PortManager';

import { logger } from '../../utils/logger';

// ============================================
// Environment Configuration
// ============================================

export type AuthMode = 'local' | 'cloud';

export interface InfrastructureConfig {
  authMode: AuthMode;
  
  // Required for all environments
  redisUrl: string;
  previewWorkers: string[];
  
  // Optional: IDE runtime selection
  k8sNamespace?: string;  // If set, use Kubernetes; otherwise use Docker
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
    logger.info(`InfrastructureFactory initialized`, { 
      component: 'InfrastructureFactory' 
    }, {
      authMode: this.config.authMode,
      redisUrl: this.config.redisUrl ? '***' : 'NOT SET',
      previewWorkers: this.config.previewWorkers.length,
      ideRuntime: this.config.k8sNamespace ? 'kubernetes' : 'docker'
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
   * 
   * ANT_SERVER_MODE only affects authentication (local:local vs real auth)
   * Infrastructure is the same for both modes (Redis, BullMQ, Remote Preview)
   * 
   * Note: Validation is lazy - only validates what's needed at the time of use.
   * - ANT_REDIS_URL: Required at factory initialization (used by most services)
   * - ANT_PREVIEW_WORKERS: Validated only when getPreviewOrchestrator() is called
   */
  private loadConfig(): InfrastructureConfig {
    const authMode = (process.env.ANT_SERVER_MODE || 'local') as AuthMode;
    const redisUrl = process.env.ANT_REDIS_URL;
    const previewWorkers = process.env.ANT_PREVIEW_WORKERS?.split(',').filter(Boolean) || [];
    
    // Validate Redis URL - required for all environments (StateStore, JobQueue, etc.)
    if (!redisUrl) {
      throw new Error(
        'ANT_REDIS_URL is required. ' +
        'Redis is required for both local and cloud environments. ' +
        'Example: ANT_REDIS_URL=redis://localhost:6379'
      );
    }
    
    // Note: ANT_PREVIEW_WORKERS validation is deferred to getPreviewOrchestrator()
    // This allows RealtimeServer to start without preview workers configured
    
    return {
      authMode,
      redisUrl,
      previewWorkers,
      k8sNamespace: process.env.ANT_K8S_NAMESPACE  // undefined = use Docker
    };
  }
  
  /**
   * Check authentication mode
   * - local: Uses local:local (no real authentication)
   * - cloud: Requires explicit authentication
   */
  isLocalAuthMode(): boolean {
    return this.config.authMode === 'local';
  }

  /**
   * Get configuration
   */
  getConfig(): InfrastructureConfig {
    return { ...this.config };
  }

  /**
   * Set dependencies (required for IDE orchestrator with Docker)
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
   * Always uses RedisStateStore (required for all environments)
   */
  getStateStore(): StateStorePort {
    if (!this.stateStore) {
      this.stateStore = new RedisStateStore({ url: this.config.redisUrl });
      logger.info('Using RedisStateStore', {
        component: 'InfrastructureFactory'
      });
    }
    
    return this.stateStore;
  }

  // ============================================
  // Job Queue
  // ============================================

  /**
   * Get JobQueuePort implementation
   * Always uses BullMQJobQueue (Redis-based, requires separate worker)
   */
  getJobQueue(): JobQueuePort {
    if (!this.jobQueue) {
      this.jobQueue = new BullMQJobQueue(
        { redisUrl: this.config.redisUrl },
        this.getStateStore()
      );
      logger.info('Using BullMQJobQueue', {
        component: 'InfrastructureFactory'
      });
    }
    
    return this.jobQueue;
  }

  // ============================================
  // Preview Orchestrator
  // ============================================

  /**
   * Get PreviewOrchestratorPort implementation
   * Always uses RemotePreviewOrchestrator (worker-based)
   * 
   * @throws Error if ANT_PREVIEW_WORKERS is not configured
   */
  getPreviewOrchestrator(): PreviewOrchestratorPort {
    if (!this.previewOrchestrator) {
      // Lazy validation: only check when preview orchestrator is actually needed
      if (this.config.previewWorkers.length === 0) {
        throw new Error(
          'ANT_PREVIEW_WORKERS is required for preview functionality. ' +
          'At least one preview worker URL must be configured. ' +
          'Example: ANT_PREVIEW_WORKERS=http://localhost:8080'
        );
      }
      
      this.previewOrchestrator = new RemotePreviewOrchestrator(
        { workers: this.config.previewWorkers },
        this.getStateStore()
      );
      logger.info(`Using RemotePreviewOrchestrator (${this.config.previewWorkers.length} workers)`, {
        component: 'InfrastructureFactory'
      });
    }
    
    return this.previewOrchestrator;
  }

  // ============================================
  // IDE Orchestrator
  // ============================================

  /**
   * Get IDEOrchestratorPort implementation
   * - With ANT_K8S_NAMESPACE: KubernetesIDEOrchestrator (K8s pods)
   * - Without: LocalIDEOrchestrator (local Docker)
   */
  getIDEOrchestrator(): IDEOrchestratorPort {
    if (!this.ideOrchestrator) {
      if (this.config.k8sNamespace) {
        // K8s mode: doesn't need PortManager/PortRegistry
        this.ideOrchestrator = new KubernetesIDEOrchestrator(
          { namespace: this.config.k8sNamespace },
          this.getStateStore()
        );
        logger.info(`Using KubernetesIDEOrchestrator (namespace: ${this.config.k8sNamespace})`, {
          component: 'InfrastructureFactory'
        });
      } else {
        // Docker mode: requires PortManager/PortRegistry
        if (!this.portManager || !this.portRegistry) {
          throw new Error('Dependencies not set for LocalIDEOrchestrator. Call setDependencies() first.');
        }
        this.ideOrchestrator = new LocalIDEOrchestrator(
          this.portManager,
          this.portRegistry
        );
        logger.info('Using LocalIDEOrchestrator (Docker)', {
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

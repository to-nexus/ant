/**
 * LocalIDEOrchestrator
 * 
 * Local (Docker-based) implementation of IDEOrchestratorPort.
 * Wraps the existing IDEService.
 * 
 * This orchestrator manages IDE containers on the local Docker daemon.
 * In cloud mode (Phase 4), KubernetesIDEOrchestrator will manage
 * K8s pods instead.
 * 
 * @see 10-cloud-scalability-design.md Section 3.2.4
 */

import {
  IDEOrchestratorPort,
  IDEParams,
  IDEStartResult,
  IDEInstance
} from '../../core/ports/ideOrchestrator';
import { IDEService, IDEInstance as IDEServiceInstance } from '../../periphery/adapters/ide/IDEService';
import { PortManager } from '../networking/PortManager';
import { PortRegistryPort } from '../../core/ports/portRegistry';
import { UserContext } from '../../core/types/user';
import { logger } from '../../utils/logger';
import { RESERVED_FEATURE_NAME } from '../../core/utils/branchUtils';

export class LocalIDEOrchestrator implements IDEOrchestratorPort {
  private ideService: IDEService;

  constructor(portManager: PortManager, portRegistry: PortRegistryPort) {
    this.ideService = new IDEService(portManager, portRegistry);
  }

  /**
   * Convert IDEService instance to IDEOrchestratorPort instance
   */
  private convertInstance(inst: IDEServiceInstance): IDEInstance {
    return {
      instanceId: inst.containerId,
      host: 'localhost',  // Always localhost for local Docker
      port: inst.port,
      url: inst.url,
      workspacePath: inst.workspacePath,
      status: inst.status,
      tenantId: inst.tenantId,
      projectId: inst.projectId,
      createdAt: inst.createdAt,
      lastAccessedAt: inst.lastAccessedAt
    };
  }

  /**
   * Start an IDE instance
   */
  async start(params: IDEParams): Promise<IDEStartResult> {
    const { userContext, projectId, workspacePath, feature = RESERVED_FEATURE_NAME } = params;

    logger.info(`Starting IDE: ${userContext.organizationId}:${userContext.userId}:${projectId}:${feature}`, {
      component: 'LocalIDEOrchestrator',
      organizationId: userContext.organizationId,
      userId: userContext.userId,
      projectId
    });

    try {
      const instance = await this.ideService.startIDE(
        userContext,
        projectId,
        workspacePath,
        feature
      );

      return {
        success: true,
        instance: this.convertInstance(instance)
      };
    } catch (error: any) {
      logger.error(`Failed to start IDE`, {
        component: 'LocalIDEOrchestrator',
        organizationId: userContext.organizationId,
        userId: userContext.userId,
        projectId
      }, error);

      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Stop an IDE instance
   */
  async stop(
    tenantId: string,
    projectId: string,
    feature: string = RESERVED_FEATURE_NAME
  ): Promise<{ success: boolean; message?: string }> {
    logger.info(`Stopping IDE: ${tenantId}:${projectId}:${feature}`, {
      component: 'LocalIDEOrchestrator'
    });

    try {
      await this.ideService.stopIDE(tenantId, projectId, feature);
      return { success: true, message: 'IDE stopped successfully' };
    } catch (error: any) {
      logger.error(`Failed to stop IDE`, {
        component: 'LocalIDEOrchestrator'
      }, error);

      return { success: false, message: error.message };
    }
  }

  /**
   * Get IDE instance status
   */
  async getStatus(
    tenantId: string,
    projectId: string,
    feature: string = RESERVED_FEATURE_NAME
  ): Promise<IDEInstance | null> {
    const instance = await this.ideService.getIDEStatus(tenantId, projectId, feature);
    
    if (!instance) {
      return null;
    }

    return this.convertInstance(instance);
  }

  /**
   * List all IDE instances
   */
  async list(): Promise<IDEInstance[]> {
    const instances = this.ideService.listIDEs();
    return instances.map((inst: IDEServiceInstance) => this.convertInstance(inst));
  }

  /**
   * List IDE instances for a specific user
   */
  async listByUser(userContext: UserContext): Promise<IDEInstance[]> {
    // Filter from all instances by user context
    const allInstances = this.ideService.listIDEs();
    const tenantPrefix = `${userContext.organizationId}:${userContext.userId}:`;
    
    return allInstances
      .filter((inst: IDEServiceInstance) => inst.tenantId.startsWith(tenantPrefix) || inst.tenantId === `${userContext.organizationId}:${userContext.userId}`)
      .map((inst: IDEServiceInstance) => this.convertInstance(inst));
  }

  /**
   * Cleanup all IDE instances for a project
   */
  async cleanupProject(
    userContext: UserContext,
    projectId: string,
    options?: { deleteHome?: boolean }
  ): Promise<void> {
    logger.info(`Cleaning up IDEs for project: ${projectId}`, {
      component: 'LocalIDEOrchestrator',
      organizationId: userContext.organizationId,
      userId: userContext.userId,
      projectId
    });

    await this.ideService.cleanupProject(userContext, projectId, options);
  }

  /**
   * Cleanup all IDE instances
   */
  async cleanup(): Promise<void> {
    logger.info('Cleaning up all IDE instances', {
      component: 'LocalIDEOrchestrator'
    });

    await this.ideService.cleanup();
  }

  /**
   * Start idle check timer
   */
  startIdleCheck(): void {
    this.ideService.startIdleChecker();
  }

  /**
   * Stop idle check timer
   */
  stopIdleCheck(): void {
    this.ideService.stopIdleChecker();
  }
}


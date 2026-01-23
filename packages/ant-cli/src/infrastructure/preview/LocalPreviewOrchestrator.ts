/**
 * LocalPreviewOrchestrator
 * 
 * Local implementation of PreviewOrchestratorPort.
 * Wraps the existing PreviewService for backward compatibility.
 * 
 * This orchestrator spawns preview processes on the local machine.
 * In cloud mode (Phase 3), RemotePreviewOrchestrator will delegate
 * to remote preview workers instead.
 * 
 * @see 10-cloud-scalability-design.md Section 3.2.3
 */

import {
  PreviewOrchestratorPort,
  PreviewParams,
  PreviewStartResult,
  PreviewInstance,
  PreviewLogEntry,
  PreviewIssue
} from '../../core/ports/previewOrchestrator';
import { PreviewService } from '../../periphery/adapters/http/services/PreviewService';
import { PortManager } from '../networking/PortManager';
import { PortRegistryPort } from '../../core/ports/portRegistry';
import { logger } from '../../utils/logger';

export class LocalPreviewOrchestrator implements PreviewOrchestratorPort {
  private previewService: PreviewService;
  private portRegistry: PortRegistryPort;

  constructor(portManager: PortManager, portRegistry: PortRegistryPort) {
    this.previewService = new PreviewService(portManager, portRegistry);
    this.portRegistry = portRegistry;
  }

  /**
   * Start a preview instance
   */
  async start(params: PreviewParams): Promise<PreviewStartResult> {
    const { tenantId, userId, projectId, feature, workspacePath, port } = params;

    logger.info(`Starting preview: ${tenantId}:${userId}:${projectId}:${feature}`, {
      component: 'LocalPreviewOrchestrator'
    });

    try {
      const result = await this.previewService.startDevServer(
        tenantId,
        userId,
        projectId,
        feature,
        workspacePath,
        port
      );

      if (!result.success) {
        return {
          success: false,
          error: result.error,
          setupReasoning: result.setupReasoning,
          setupReason: result.setupReason,
          suggestedFix: result.suggestedFix,
          issues: result.issues
        };
      }

      // Get full status for the instance
      const status = this.previewService.getDevServerStatus(
        tenantId,
        userId,
        projectId,
        feature
      );

      const instance: PreviewInstance = {
        instanceId: result.serverKey || `${tenantId}:${userId}:${projectId}:${feature}`,
        host: 'localhost',  // Always localhost for local orchestrator
        port: result.port || status?.port || 0,
        status: status?.running ? 'running' : 'starting',
        url: result.url || status?.url,
        packages: status?.packages,
        backendPort: status?.backendPort,
        processCount: status?.processCount,
        startedAt: new Date().toISOString()
      };

      return {
        success: true,
        instance
      };
    } catch (error: any) {
      logger.error(`Failed to start preview`, {
        component: 'LocalPreviewOrchestrator'
      }, error);

      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Stop a preview instance
   */
  async stop(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string
  ): Promise<{ success: boolean; message?: string }> {
    logger.info(`Stopping preview: ${tenantId}:${userId}:${projectId}:${feature}`, {
      component: 'LocalPreviewOrchestrator'
    });

    return this.previewService.stopDevServer(tenantId, userId, projectId, feature);
  }

  /**
   * Get preview instance status
   */
  getStatus(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string
  ): PreviewInstance | null {
    const status = this.previewService.getDevServerStatus(
      tenantId,
      userId,
      projectId,
      feature
    );

    if (!status) {
      return null;
    }

    return {
      instanceId: `${tenantId}:${userId}:${projectId}:${feature}`,
      host: 'localhost',
      port: status.port || 0,
      status: status.running ? (status.ready ? 'running' : 'starting') : 'stopped',
      url: status.url,
      packages: status.packages,
      backendPort: status.backendPort,
      processCount: status.processCount
    };
  }

  /**
   * Get logs for a preview instance
   */
  getLogs(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string
  ): PreviewLogEntry[] {
    const logs = this.previewService.getDevServerLogs(
      tenantId,
      userId,
      projectId,
      feature
    );

    return logs.map((log: { type: string; message: string; timestamp?: string; packageName?: string }) => ({
      type: log.type as 'stdout' | 'stderr' | 'info' | 'error',
      message: log.message,
      timestamp: log.timestamp || new Date().toISOString(),
      packageName: log.packageName
    }));
  }

  /**
   * Stream logs in real-time
   */
  streamLogs(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string,
    callback: (log: PreviewLogEntry) => void
  ): () => void {
    // PreviewService uses a different streaming mechanism (Express response)
    // For the orchestrator interface, we provide a callback-based approach
    // This will need to be connected to the existing SSE infrastructure
    
    // For now, return a no-op unsubscribe
    // TODO: Integrate with SSE service for real-time log streaming
    logger.debug(`Log streaming requested for ${tenantId}:${userId}:${projectId}:${feature}`, {
      component: 'LocalPreviewOrchestrator'
    });
    
    return () => {
      // Unsubscribe
    };
  }

  /**
   * Validate preview setup
   */
  async validateSetup(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string,
    workspacePath: string
  ): Promise<{
    isValid: boolean;
    issues?: PreviewIssue[];
  }> {
    const result = await this.previewService.validateDevServerSetup(
      workspacePath
    );

    // Convert ValidationResult to PreviewOrchestratorPort format
    const issues: PreviewIssue[] = [];
    if (!result.valid && result.reason) {
      issues.push({
        reasoning: result.reasoning || 'validation_failed',
        severity: 'fatal',
        reason: result.reason,
        suggestedFix: result.suggestedFix
      });
    }

    return {
      isValid: result.valid,
      issues: issues.length > 0 ? issues : undefined
    };
  }

  /**
   * List all active preview instances
   */
  async listInstances(): Promise<PreviewInstance[]> {
    const portMappings = await this.portRegistry.listPreviews();

    return portMappings.map(mapping => {
      const status = this.previewService.getDevServerStatus(
        mapping.tenantId,
        mapping.userId,
        mapping.projectId,
        mapping.feature
      );

      return {
        instanceId: `${mapping.tenantId}:${mapping.userId}:${mapping.projectId}:${mapping.feature}`,
        host: 'localhost',
        port: mapping.port,
        status: status?.running ? (status.ready ? 'running' : 'starting') : 'stopped',
        url: status?.url,
        packages: status?.packages,
        backendPort: status?.backendPort,
        processCount: status?.processCount
      };
    });
  }

  /**
   * Cleanup all instances
   */
  async cleanup(): Promise<void> {
    logger.info('Cleaning up all preview instances', {
      component: 'LocalPreviewOrchestrator'
    });

    await this.previewService.cleanup();
  }
}

/**
 * IDEService
 * 
 * Manages user-specific IDE containers.
 * Each user gets their own isolated IDE environment.
 */

import Docker from 'dockerode';
import { UserContext } from '../../../core/types/user';
import { PortManager } from '../../../infrastructure/networking/PortManager';
import { PortRegistryPort } from '../../../core/ports/portRegistry';

export interface IDEInstance {
  containerId: string;
  port: number;
  url: string;
  workspacePath: string;  // ✅ Docker 내부 경로 추가
  tenantId: string;
  projectId: string;
  status: 'starting' | 'running' | 'stopped' | 'error';
  createdAt: Date;
  lastAccessedAt: Date;
}

export class IDEService {
  private docker: Docker;
  private portManager: PortManager;
  private portRegistry: PortRegistryPort;
  private instances: Map<string, IDEInstance> = new Map();
  private idleCheckInterval?: NodeJS.Timeout;
  
  private readonly IDLE_TIMEOUT = 30 * 60 * 1000; // 30 minutes
  private readonly IMAGE = 'codercom/code-server:latest';
  
  constructor(portManager: PortManager, portRegistry: PortRegistryPort) {
    this.docker = new Docker();
    this.portManager = portManager;
    this.portRegistry = portRegistry;
  }
  
  /**
   * Start IDE for user/project
   */
  async startIDE(userContext: UserContext, projectId: string, workspacePath: string, feature: string = 'main'): Promise<IDEInstance> {
    const tenantId = `${userContext.organizationId}:${userContext.userId}`;
    const key = `${tenantId}:${projectId}:${feature}`;
    
    // Check if already running
    const existing = this.instances.get(key);
    if (existing && existing.status === 'running') {
      existing.lastAccessedAt = new Date();
      
      // Update last access in registry
      await this.portRegistry.updateLastAccess(
        userContext.organizationId,
        userContext.userId,
        projectId,
        feature,
        'ide'
      );
      
      console.log(`[IDEService] IDE already running: ${key}`);
      return existing;
    }
    
    console.log(`[IDEService] Starting IDE: ${key}`);
    console.log(`[IDEService] Host workspace path: ${workspacePath}`);
    
    // Allocate port
    const port = await this.portManager.allocate();
    
    // ✅ Get workspace base path from environment
    const workspaceBasePath = process.env.ANT_WORKSPACE_BASE_PATH || '/Users/probe/dev/ant-workspaces';
    console.log(`[IDEService] Workspace base path: ${workspaceBasePath}`);
    
    // ✅ Calculate Docker internal path
    // Host: /Users/probe/dev/ant-workspaces/org/user/project/codebase
    // Docker: /workspace/org/user/project/codebase
    const dockerWorkspacePath = workspacePath.replace(workspaceBasePath, '/workspace');
    console.log(`[IDEService] Docker workspace path: ${dockerWorkspacePath}`);
    
    try {
      // Register in PortRegistry
      await this.portRegistry.registerIDE(
        userContext.organizationId,
        userContext.userId,
        projectId,
        feature,
        port
      );
      
      // Create container
      const container = await this.docker.createContainer({
        Image: this.IMAGE,
        Env: [
          `USER_ID=${userContext.userId}`,
          `ORG_ID=${userContext.organizationId}`,
          `PROJECT_ID=${projectId}`,
          `FEATURE=${feature}`,
          'PASSWORD=temp123', // TODO: Generate secure password
        ],
        ExposedPorts: {
          '8080/tcp': {}
        },
        HostConfig: {
          // ✅ Mount entire workspace base directory
          Binds: [`${workspaceBasePath}:/workspace:rw`],
          PortBindings: {
            '8080/tcp': [{ HostPort: port.toString() }]
          },
          Memory: 2 * 1024 * 1024 * 1024, // 2GB
          NanoCpus: 2 * 1000000000, // 2 CPUs
        },
        // ✅ Set working directory to specific project
        WorkingDir: dockerWorkspacePath
      });
      
      // Start container
      await container.start();
      
      const instance: IDEInstance = {
        containerId: container.id,
        port,
        url: `/ide/${userContext.organizationId}:${userContext.userId}:${projectId}:${feature}`,
        workspacePath: dockerWorkspacePath,  // ✅ Docker 내부 경로 저장
        tenantId,
        projectId,
        status: 'running',
        createdAt: new Date(),
        lastAccessedAt: new Date()
      };
      
      this.instances.set(key, instance);
      
      console.log(`[IDEService] ✅ IDE started: ${key} on port ${port}`);
      
      return instance;
      
    } catch (error) {
      // Rollback port allocation and registry
      this.portManager.release(port);
      await this.portRegistry.unregisterIDE(
        userContext.organizationId,
        userContext.userId,
        projectId,
        feature
      ).catch(console.error);
      throw error;
    }
  }
  
  /**
   * Stop IDE
   */
  async stopIDE(tenantId: string, projectId: string, feature: string = 'main'): Promise<void> {
    const key = `${tenantId}:${projectId}:${feature}`;
    const instance = this.instances.get(key);
    
    if (!instance) {
      console.log(`[IDEService] IDE not found: ${key}`);
      return;
    }
    
    console.log(`[IDEService] Stopping IDE: ${key}`);
    
    try {
      const container = this.docker.getContainer(instance.containerId);
      await container.stop();
      await container.remove();
      
      // Release port
      this.portManager.release(instance.port);
      
      // Unregister from PortRegistry
      const [orgId, userId] = tenantId.split(':');
      await this.portRegistry.unregisterIDE(orgId, userId, projectId, feature);
      
      this.instances.delete(key);
      
      console.log(`[IDEService] ✅ IDE stopped: ${key}`);
      
    } catch (error) {
      console.error(`[IDEService] ❌ Failed to stop IDE: ${key}`, error);
      throw error;
    }
  }
  
  /**
   * Get IDE status
   */
  async getIDEStatus(tenantId: string, projectId: string, feature: string = 'main'): Promise<IDEInstance | null> {
    const key = `${tenantId}:${projectId}:${feature}`;
    const instance = this.instances.get(key);
    
    if (!instance) {
      return null;
    }
    
    // Update last accessed
    instance.lastAccessedAt = new Date();
    
    // Update in registry
    const [orgId, userId] = tenantId.split(':');
    await this.portRegistry.updateLastAccess(orgId, userId, projectId, feature, 'ide');
    
    return instance;
  }
  
  /**
   * List all running IDEs
   */
  listIDEs(): IDEInstance[] {
    return Array.from(this.instances.values());
  }
  
  /**
   * Start idle checker (auto-shutdown)
   */
  startIdleChecker(): void {
    if (this.idleCheckInterval) {
      return;
    }
    
    this.idleCheckInterval = setInterval(async () => {
      await this.checkIdleContainers();
    }, 60 * 1000); // Check every minute
    
    console.log(`[IDEService] Idle checker started (timeout: ${this.IDLE_TIMEOUT / 1000}s)`);
  }
  
  /**
   * Stop idle checker
   */
  stopIdleChecker(): void {
    if (this.idleCheckInterval) {
      clearInterval(this.idleCheckInterval);
      this.idleCheckInterval = undefined;
      console.log(`[IDEService] Idle checker stopped`);
    }
  }
  
  /**
   * Check and stop idle containers
   */
  private async checkIdleContainers(): Promise<void> {
    const now = Date.now();
    
    for (const [key, instance] of this.instances.entries()) {
      const idleTime = now - instance.lastAccessedAt.getTime();
      
      if (idleTime > this.IDLE_TIMEOUT) {
        console.log(`[IDEService] 💤 Stopping idle IDE: ${key} (idle: ${Math.round(idleTime / 1000)}s)`);
        
        try {
          const [tenantId, projectId, feature] = key.split(':');
          const fullTenantId = `${tenantId}:${projectId}`;  // Reconstruct full tenantId
          await this.stopIDE(fullTenantId, feature || 'main', feature || 'main');
        } catch (error) {
          console.error(`[IDEService] Failed to stop idle IDE: ${key}`, error);
        }
      }
    }
  }
  
  /**
   * Cleanup all IDEs
   */
  async cleanup(): Promise<void> {
    console.log(`[IDEService] Cleaning up all IDEs...`);
    
    this.stopIdleChecker();
    
    const keys = Array.from(this.instances.keys());
    
    for (const key of keys) {
      const parts = key.split(':');
      if (parts.length >= 3) {
        const [orgId, userId, projectId, ...featureParts] = parts;
        const tenantId = `${orgId}:${userId}`;
        const feature = featureParts.join(':') || 'main';
        
        try {
          await this.stopIDE(tenantId, projectId, feature);
        } catch (error) {
          console.error(`[IDEService] Failed to cleanup IDE: ${key}`, error);
        }
      }
    }
    
    console.log(`[IDEService] ✅ Cleanup complete`);
  }
}


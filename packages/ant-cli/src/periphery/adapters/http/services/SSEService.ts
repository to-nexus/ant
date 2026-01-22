import { Response } from 'express';
import { logger } from '../../../../utils/logger';
import type { UserContext } from '../../../../core/types/user';

/**
 * Message types for unified SSE stream
 */
export type SSEMessageType = 'kanban' | 'chat' | 'fileTree' | 'workflow' | 'preview' | 'gitChange';

export interface SSEMessage {
  type: SSEMessageType;
  timestamp: string;
  data: any;
}

/**
 * SSEService
 * 
 * Single SSE service that handles all real-time updates
 * Consolidates kanban, chat, fileTree, and workflow SSE streams
 */
export class SSEService {
  // Single SSE connection per project/feature
  // key: "projectId/featureName"
  private clients: Map<string, Set<Response>> = new Map();
  
  // Workflow SSE clients (per jobId)
  // key: jobId
  private workflowClients: Map<string, Set<Response>> = new Map();
  
  /**
   * Get session key for a project/feature
   */
  private getSessionKey(projectId: string, featureName: string, userContext?: UserContext): string {
    // ✅ Cloud-safe: scope by tenant/user to prevent cross-user collisions
    // Local mode stays readable: "local:local:project/feature"
    const org = userContext?.organizationId || 'local';
    const user = userContext?.userId || 'local';
    return `${org}:${user}:${projectId}/${featureName}`;
  }
  
  /**
   * Register SSE client for a project/feature
   */
  registerClient(projectId: string, featureName: string, res: Response, userContext?: UserContext): void {
    const key = this.getSessionKey(projectId, featureName, userContext);
    
    if (!this.clients.has(key)) {
      this.clients.set(key, new Set());
    }
    
    this.clients.get(key)!.add(res);
    logger.debug(`Client registered: ${key} (total: ${this.clients.get(key)!.size})`, { component: 'SSEService', projectId, featureName });
    
    // Handle client disconnect
    res.on('close', () => {
      this.clients.get(key)?.delete(res);
      if (this.clients.get(key)?.size === 0) {
        this.clients.delete(key);
      }
      logger.debug(`Client disconnected: ${key}`, { component: 'SSEService', projectId, featureName });
    });
  }
  
  /**
   * Register workflow SSE client for a job
   */
  registerWorkflowClient(jobId: string, res: Response): void {
    if (!this.workflowClients.has(jobId)) {
      this.workflowClients.set(jobId, new Set());
    }
    
    this.workflowClients.get(jobId)!.add(res);
    logger.debug(`Workflow client registered: ${jobId} (total: ${this.workflowClients.get(jobId)!.size})`, { component: 'SSEService', jobId });
    
    // Handle client disconnect
    res.on('close', () => {
      this.workflowClients.get(jobId)?.delete(res);
      if (this.workflowClients.get(jobId)?.size === 0) {
        this.workflowClients.delete(jobId);
      }
      logger.debug(`Workflow client disconnected: ${jobId}`, { component: 'SSEService', jobId });
    });
  }
  
  /**
   * Broadcast message to project/feature clients
   */
  broadcast(projectId: string, featureName: string, type: SSEMessageType, data: any, userContext?: UserContext): void {
    const key = this.getSessionKey(projectId, featureName, userContext);
    const clients = this.clients.get(key);
    
    if (!clients || clients.size === 0) {
      // Silent return - no clients is a normal scenario (background jobs, API calls, etc.)
      return;
    }
    
    const message: SSEMessage = {
      type,
      timestamp: new Date().toISOString(),
      data
    };
    
    const dataString = JSON.stringify(message);
    
    clients.forEach(res => {
      try {
        res.write(`data: ${dataString}\n\n`);
      } catch (error) {
        logger.warn(`Failed to send to client`, { component: 'SSEService', projectId, featureName }, error);
        clients.delete(res);
      }
    });
  }
  
  /**
   * Broadcast message to all features of a project (project-level events)
   * Used for git init/clone indexing status (no specific feature context)
   */
  broadcastToProject(projectId: string, data: any, userContext?: UserContext): void {
    let sentCount = 0;
    
    const org = userContext?.organizationId || 'local';
    const user = userContext?.userId || 'local';
    const projectPrefix = `${org}:${user}:${projectId}/`;
    
    // Find all clients for this project (all features)
    this.clients.forEach((clients, key) => {
      if (key.startsWith(projectPrefix)) {
        const message: SSEMessage = {
          type: 'chat',
          timestamp: new Date().toISOString(),
          data
        };
        
        const dataString = JSON.stringify(message);
        
        clients.forEach(res => {
          try {
            res.write(`data: ${dataString}\n\n`);
            sentCount++;
          } catch (error) {
            logger.warn(`Failed to send to client`, { component: 'SSEService', projectId }, error);
            clients.delete(res);
          }
        });
      }
    });
    
    if (sentCount > 0) {
      logger.debug(`Broadcast to ${sentCount} client(s) in project ${projectId}`, { component: 'SSEService', projectId });
    }
  }
  
  /**
   * Broadcast workflow message to job clients
   */
  broadcastWorkflow(jobId: string, data: any): void {
    const clients = this.workflowClients.get(jobId);
    
    if (!clients || clients.size === 0) {
      return;
    }
    
    const message: SSEMessage = {
      type: 'workflow',
      timestamp: new Date().toISOString(),
      data
    };
    
    const dataString = JSON.stringify(message);
    
    clients.forEach(res => {
      try {
        res.write(`data: ${dataString}\n\n`);
      } catch (error) {
        logger.warn(`Failed to send workflow to client`, { component: 'SSEService', jobId }, error);
        clients.delete(res);
      }
    });
  }
  
  /**
   * Send 'end' event to workflow clients to signal job completion
   */
  sendWorkflowEndEvent(jobId: string): void {
    const clients = this.workflowClients.get(jobId);
    
    if (!clients || clients.size === 0) {
      return;
    }
    
    logger.debug(`Sending end event to ${clients.size} workflow client(s)`, { component: 'SSEService', jobId });
    
    clients.forEach(res => {
      try {
        res.write(`event: end\ndata: ${JSON.stringify({ jobId })}\n\n`);
      } catch (error) {
        logger.warn(`Failed to send end event to client`, { component: 'SSEService', jobId }, error);
        clients.delete(res);
      }
    });
  }
  
  /**
   * Send initial state to a newly connected client
   */
  sendInitialState(res: Response, type: SSEMessageType, data: any): void {
    const message: SSEMessage = {
      type,
      timestamp: new Date().toISOString(),
      data
    };
    
    try {
      res.write(`data: ${JSON.stringify(message)}\n\n`);
      logger.debug(`Sent initial ${type} state to client`, { component: 'SSEService' });
    } catch (error) {
      logger.warn(`Failed to send initial ${type} state`, { component: 'SSEService' }, error);
    }
  }
  
  /**
   * Get number of connected clients for a project/feature
   */
  getClientCount(projectId: string, featureName: string, userContext?: UserContext): number {
    const key = this.getSessionKey(projectId, featureName, userContext);
    return this.clients.get(key)?.size || 0;
  }
  
  /**
   * Get number of workflow clients for a job
   */
  getWorkflowClientCount(jobId: string): number {
    return this.workflowClients.get(jobId)?.size || 0;
  }
  
  /**
   * Close all connections for a project/feature
   */
  closeClients(projectId: string, featureName: string, userContext?: UserContext): void {
    const key = this.getSessionKey(projectId, featureName, userContext);
    const clients = this.clients.get(key);
    
    if (clients) {
      clients.forEach(res => {
        try {
          res.end();
        } catch (error) {
          // Ignore errors on close
        }
      });
      this.clients.delete(key);
      logger.debug(`Closed all clients for ${key}`, { component: 'SSEService', projectId, featureName });
    }
  }
  
  /**
   * Close all workflow connections for a job
   */
  closeWorkflowClients(jobId: string): void {
    const clients = this.workflowClients.get(jobId);
    
    if (clients) {
      clients.forEach(res => {
        try {
          res.end();
        } catch (error) {
          // Ignore errors on close
        }
      });
      this.workflowClients.delete(jobId);
      logger.debug(`Closed all workflow clients for ${jobId}`, { component: 'SSEService', jobId });
    }
  }
}


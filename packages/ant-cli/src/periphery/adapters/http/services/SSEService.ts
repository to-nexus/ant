import { Response } from 'express';
import { logger } from '../../../../utils/logger';
import type { UserContext } from '../../../../core/types/user';
import type { StateStorePort } from '../../../../core/ports/stateStore';
import { CHAT_BROADCAST_CHANNEL, type ChatBroadcastMessage } from './ChatService/MessageBroadcaster';
import { REDIS_CHANNELS } from '../../../../infrastructure/state';

/**
 * Message types for unified SSE stream
 */
export type SSEMessageType = 'kanban' | 'chat' | 'fileTree' | 'workflow' | 'preview' | 'gitChange';

export interface SSEMessage {
  type: SSEMessageType;
  timestamp: string;
  data: any;
}

// Redis Pub/Sub channels - re-export from central definition for backward compatibility
export const SSE_BROADCAST_CHANNEL = REDIS_CHANNELS.SSE_BROADCAST;
export const SSE_WORKFLOW_CHANNEL = REDIS_CHANNELS.SSE_WORKFLOW;

export interface SSEBroadcastMessage {
  projectId: string;
  featureName: string;
  type: SSEMessageType;
  data: any;
  userContext?: UserContext;
}

export interface SSEWorkflowMessage {
  jobId: string;
  data: any;
  isEndEvent?: boolean;
}

/**
 * SSEService
 * 
 * Single SSE service that handles all real-time updates
 * Consolidates kanban, chat, fileTree, and workflow SSE streams
 * 
 * Cloud-safe: All broadcasts go through Redis Pub/Sub for cross-instance delivery
 */
export class SSEService {
  // Single SSE connection per project/feature
  // key: "projectId/featureName"
  private clients: Map<string, Set<Response>> = new Map();
  
  // Workflow SSE clients (per jobId)
  // key: jobId
  private workflowClients: Map<string, Set<Response>> = new Map();
  
  // StateStore for Redis Pub/Sub (set via setupBroadcastSubscriptions)
  private stateStore?: StateStorePort;
  
  /**
   * Setup all Redis Pub/Sub subscriptions for cross-instance broadcasting
   * This enables SSE broadcasting in cloud/distributed environments
   */
  async setupBroadcastSubscriptions(stateStore: StateStorePort): Promise<void> {
    this.stateStore = stateStore;
    
    try {
      // 1. Subscribe to chat broadcast (from MessageBroadcaster)
      await stateStore.subscribe(CHAT_BROADCAST_CHANNEL, (message: ChatBroadcastMessage) => {
        const { projectId, featureName, data, userContext } = message;
        this.broadcastLocal(projectId, featureName, 'chat', data, userContext);
      });
      logger.info('Subscribed to chat:broadcast channel', { component: 'SSEService' });
      
      // 2. Subscribe to general SSE broadcast (kanban, fileTree, etc.)
      await stateStore.subscribe(SSE_BROADCAST_CHANNEL, (message: SSEBroadcastMessage) => {
        const { projectId, featureName, type, data, userContext } = message;
        this.broadcastLocal(projectId, featureName, type, data, userContext);
      });
      logger.info('Subscribed to sse:broadcast channel', { component: 'SSEService' });
      
      // 3. Subscribe to workflow broadcast
      await stateStore.subscribe(SSE_WORKFLOW_CHANNEL, (message: SSEWorkflowMessage) => {
        const { jobId, data, isEndEvent } = message;
        if (isEndEvent) {
          this.sendWorkflowEndEventLocal(jobId);
        } else {
          this.broadcastWorkflowLocal(jobId, data);
        }
      });
      logger.info('Subscribed to sse:workflow channel', { component: 'SSEService' });
      
      // Note: Preview status uses sse:broadcast with type:'preview' (handled by #2 above)
      
      logger.info('All SSE broadcast subscriptions ready', { component: 'SSEService' });
    } catch (error) {
      logger.error('Failed to setup SSE broadcast subscriptions', { component: 'SSEService' }, error);
    }
  }
  
  /**
   * Get session key for a project/feature
   */
  private getSessionKey(projectId: string, featureName: string, userContext?: UserContext): string {
    // Cloud-safe: scope by tenant/user to prevent cross-user collisions
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
   * Broadcast message to project/feature clients via Redis Pub/Sub
   * All API Server instances will receive this and forward to their local SSE clients
   * 
   * Note: For 'chat' type, use MessageBroadcaster instead (it has its own channel)
   */
  broadcast(projectId: string, featureName: string, type: SSEMessageType, data: any, userContext?: UserContext): void {
    // Chat messages go through MessageBroadcaster's own channel
    // Other types (kanban, fileTree, etc.) use the general SSE channel
    if (type === 'chat') {
      // Chat should use MessageBroadcaster, but fallback to local for backward compatibility
      this.broadcastLocal(projectId, featureName, type, data, userContext);
      return;
    }
    
    if (!this.stateStore) {
      // Fallback to local broadcast if Redis not available
      this.broadcastLocal(projectId, featureName, type, data, userContext);
      return;
    }
    
    const message: SSEBroadcastMessage = {
      projectId,
      featureName,
      type,
      data,
      userContext
    };
    
    // Fire-and-forget: publish to Redis
    this.stateStore.publish(SSE_BROADCAST_CHANNEL, message).catch((error) => {
      logger.error(`Failed to publish SSE broadcast (${type}) to Redis`, { 
        component: 'SSEService', 
        projectId, 
        featureName
      }, error);
      // Fallback to local broadcast
      this.broadcastLocal(projectId, featureName, type, data, userContext);
    });
  }
  
  /**
   * Broadcast to local SSE clients only (called from Redis subscription)
   * 
   * IMPORTANT: Uses fallback matching to handle userContext mismatches
   * - First tries exact key match with userContext
   * - Falls back to matching any client with same projectId/featureName
   */
  private broadcastLocal(projectId: string, featureName: string, type: SSEMessageType, data: any, userContext?: UserContext): void {
    // Try exact key match first
    const key = this.getSessionKey(projectId, featureName, userContext);
    let clients = this.clients.get(key);
    
    // If no exact match, try to find clients by projectId/featureName suffix
    // This handles cases where userContext differs between sender and receiver
    if (!clients || clients.size === 0) {
      const suffix = `${projectId}/${featureName}`;
      for (const [clientKey, clientSet] of this.clients.entries()) {
        if (clientKey.endsWith(suffix) && clientSet.size > 0) {
          clients = clientSet;
          logger.debug(`[SSE Broadcast] Using fallback match: ${clientKey} for ${key}`, {
            component: 'SSEService',
            projectId,
            featureName
          });
          break;
        }
      }
    }
    
    if (!clients || clients.size === 0) {
      // NOTE: In multi-pod environment, this is normal - each pod only has its own local clients
      // The pod that has the actual SSE client will deliver the message
      // Removed noisy console.log that was flooding logs
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
   * Broadcast workflow message to job clients via Redis Pub/Sub
   */
  broadcastWorkflow(jobId: string, data: any): void {
    if (!this.stateStore) {
      // Fallback to local broadcast if Redis not available
      this.broadcastWorkflowLocal(jobId, data);
      return;
    }
    
    const message: SSEWorkflowMessage = {
      jobId,
      data,
      isEndEvent: false
    };
    
    // Fire-and-forget: publish to Redis
    this.stateStore.publish(SSE_WORKFLOW_CHANNEL, message).catch((error) => {
      logger.error('Failed to publish workflow broadcast to Redis', { 
        component: 'SSEService', 
        jobId
      }, error);
      // Fallback to local broadcast
      this.broadcastWorkflowLocal(jobId, data);
    });
  }
  
  /**
   * Broadcast workflow to local clients only (called from Redis subscription)
   */
  private broadcastWorkflowLocal(jobId: string, data: any): void {
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
   * Send 'end' event to workflow clients to signal job completion via Redis Pub/Sub
   */
  sendWorkflowEndEvent(jobId: string): void {
    if (!this.stateStore) {
      // Fallback to local
      this.sendWorkflowEndEventLocal(jobId);
      return;
    }
    
    const message: SSEWorkflowMessage = {
      jobId,
      data: { jobId },
      isEndEvent: true
    };
    
    // Fire-and-forget: publish to Redis
    this.stateStore.publish(SSE_WORKFLOW_CHANNEL, message).catch((error) => {
      logger.error('Failed to publish workflow end event to Redis', { 
        component: 'SSEService', 
        jobId
      }, error);
      // Fallback to local
      this.sendWorkflowEndEventLocal(jobId);
    });
  }
  
  /**
   * Send workflow end event to local clients only
   */
  private sendWorkflowEndEventLocal(jobId: string): void {
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

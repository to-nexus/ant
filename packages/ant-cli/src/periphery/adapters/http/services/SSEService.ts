import { Response } from 'express';
import { logger } from '../../../../utils/logger';
import type { UserContext } from '../../../../core/types/user';
import type { StateStorePort } from '../../../../core/ports/stateStore';
import { 
  getSSEBroadcastChannel, 
  getSSEWorkflowChannel
} from '../../../../infrastructure/state';

/**
 * Message types for unified SSE stream
 */
export type SSEMessageType = 'kanban' | 'chat' | 'fileTree' | 'workflow' | 'preview' | 'gitChange';

export interface SSEMessage {
  type: SSEMessageType;
  timestamp: string;
  data: any;
}

export interface SSEBroadcastMessage {
  projectId: string;
  featureName: string;
  type: SSEMessageType;
  data: any;
  userContext: UserContext;  // Required for user-scoped channels
}

export interface SSEWorkflowMessage {
  jobId: string;
  data: any;
  isEndEvent?: boolean;
  userContext: UserContext;  // Required for user-scoped channels
}

/**
 * SSEService
 * 
 * Single SSE service that handles all real-time updates
 * Consolidates kanban, chat, fileTree, and workflow SSE streams
 * 
 * Cloud-safe: Uses user-scoped Redis Pub/Sub channels for multi-tenant isolation
 * 
 * Channel format:
 * - sse:broadcast:{orgId}:{userId}  - Kanban, FileTree, Preview, Job status
 * - sse:workflow:{orgId}:{userId}   - Workflow state updates
 */
export class SSEService {
  // SSE clients per session key
  // key: "{orgId}:{userId}:{projectId}/{featureName}"
  private clients: Map<string, Set<Response>> = new Map();
  
  // Workflow SSE clients (per jobId)
  // key: jobId
  private workflowClients: Map<string, Set<Response>> = new Map();
  
  // Track subscribed channels to avoid duplicate subscriptions
  private subscribedChannels: Set<string> = new Set();
  
  // StateStore for Redis Pub/Sub
  private stateStore?: StateStorePort;
  
  /**
   * Setup base Redis Pub/Sub subscriptions
   * Note: User-specific channels are subscribed dynamically when clients register
   * 
   * All SSE messages (chat, kanban, workflow, fileTree, preview, gitChange) now use
   * user-scoped channels: sse:broadcast:{orgId}:{userId} and sse:workflow:{orgId}:{userId}
   */
  async setupBroadcastSubscriptions(stateStore: StateStorePort): Promise<void> {
    this.stateStore = stateStore;
    
    // No global channel subscriptions needed anymore.
    // User-specific channels are subscribed dynamically in subscribeToUserChannels()
    logger.info('SSEService ready (user-scoped channel subscriptions)', { component: 'SSEService' });
  }
  
  /**
   * Subscribe to user-specific channels when a client registers
   */
  private async subscribeToUserChannels(userContext: UserContext): Promise<void> {
    if (!this.stateStore) return;
    
    const { organizationId: orgId, userId } = userContext;
    if (!orgId || !userId) {
      logger.warn('Cannot subscribe to user channels: missing userContext', { component: 'SSEService' });
      return;
    }
    
    // Subscribe to SSE broadcast channel for this user
    const broadcastChannel = getSSEBroadcastChannel(orgId, userId);
    if (!this.subscribedChannels.has(broadcastChannel)) {
      await this.stateStore.subscribe(broadcastChannel, (message: SSEBroadcastMessage) => {
        const { projectId, featureName, type, data, userContext: msgUserContext } = message;
        this.broadcastLocal(projectId, featureName, type, data, msgUserContext);
      });
      this.subscribedChannels.add(broadcastChannel);
      logger.info(`Subscribed to user SSE channel: ${broadcastChannel}`, { component: 'SSEService' });
    }
    
    // Subscribe to workflow channel for this user
    const workflowChannel = getSSEWorkflowChannel(orgId, userId);
    if (!this.subscribedChannels.has(workflowChannel)) {
      await this.stateStore.subscribe(workflowChannel, (message: SSEWorkflowMessage) => {
        const { jobId, data, isEndEvent } = message;
        if (isEndEvent) {
          this.sendWorkflowEndEventLocal(jobId);
        } else {
          this.broadcastWorkflowLocal(jobId, data);
        }
      });
      this.subscribedChannels.add(workflowChannel);
      logger.info(`Subscribed to user workflow channel: ${workflowChannel}`, { component: 'SSEService' });
    }
  }
  
  /**
   * Get session key for a project/feature (includes user context for isolation)
   */
  private getSessionKey(projectId: string, featureName: string, userContext: UserContext): string {
    const org = userContext.organizationId;
    const user = userContext.userId;
    return `${org}:${user}:${projectId}/${featureName}`;
  }
  
  /**
   * Register SSE client for a project/feature
   * Subscribes to user-specific channels on first registration
   */
  registerClient(projectId: string, featureName: string, res: Response, userContext: UserContext): void {
    if (!userContext?.organizationId || !userContext?.userId) {
      logger.error('Cannot register client without userContext', { component: 'SSEService', projectId, featureName });
      return;
    }
    
    const key = this.getSessionKey(projectId, featureName, userContext);
    
    if (!this.clients.has(key)) {
      this.clients.set(key, new Set());
    }
    
    this.clients.get(key)!.add(res);
    logger.debug(`Client registered: ${key} (total: ${this.clients.get(key)!.size})`, { component: 'SSEService', projectId, featureName });
    
    // Subscribe to user-specific channels (if not already subscribed)
    this.subscribeToUserChannels(userContext).catch(error => {
      logger.error('Failed to subscribe to user channels', { component: 'SSEService' }, error);
    });
    
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
  registerWorkflowClient(jobId: string, res: Response, userContext?: UserContext): void {
    if (!this.workflowClients.has(jobId)) {
      this.workflowClients.set(jobId, new Set());
    }
    
    this.workflowClients.get(jobId)!.add(res);
    logger.debug(`Workflow client registered: ${jobId} (total: ${this.workflowClients.get(jobId)!.size})`, { component: 'SSEService', jobId });
    
    // Subscribe to user-specific workflow channel
    if (userContext?.organizationId && userContext?.userId) {
      this.subscribeToUserChannels(userContext).catch(error => {
        logger.error('Failed to subscribe to user workflow channels', { component: 'SSEService' }, error);
      });
    }
    
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
   * Broadcast message to project/feature clients via user-scoped Redis Pub/Sub
   */
  broadcast(projectId: string, featureName: string, type: SSEMessageType, data: any, userContext: UserContext): void {
    if (!userContext?.organizationId || !userContext?.userId) {
      logger.error('Cannot broadcast without userContext', { component: 'SSEService', projectId, featureName }, { type });
      return;
    }
    
    // Chat messages go through MessageBroadcaster's own channel
    if (type === 'chat') {
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
    
    // Publish to user-specific channel
    const channel = getSSEBroadcastChannel(userContext.organizationId, userContext.userId);
    
    this.stateStore.publish(channel, message).catch((error) => {
      logger.error(`Failed to publish SSE broadcast (${type}) to Redis channel ${channel}`, { 
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
   * Strict matching: only delivers to exact userContext match
   */
  private broadcastLocal(projectId: string, featureName: string, type: SSEMessageType, data: any, userContext: UserContext): void {
    if (!userContext?.organizationId || !userContext?.userId) {
      logger.warn('broadcastLocal called without userContext, ignoring', { component: 'SSEService', projectId, featureName });
      return;
    }
    
    // Strict key match - NO FALLBACK
    const key = this.getSessionKey(projectId, featureName, userContext);
    const clients = this.clients.get(key);
    
    if (!clients || clients.size === 0) {
      // In multi-pod environment, this is normal
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
   */
  broadcastToProject(projectId: string, data: any, userContext: UserContext): void {
    if (!userContext?.organizationId || !userContext?.userId) {
      logger.error('Cannot broadcastToProject without userContext', { component: 'SSEService', projectId });
      return;
    }
    
    let sentCount = 0;
    const projectPrefix = `${userContext.organizationId}:${userContext.userId}:${projectId}/`;
    
    // Find all clients for this project (all features) - strict prefix match
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
   * Broadcast workflow message to job clients via user-scoped Redis Pub/Sub
   */
  broadcastWorkflow(jobId: string, data: any, userContext?: UserContext): void {
    if (!this.stateStore || !userContext?.organizationId || !userContext?.userId) {
      // Fallback to local broadcast if Redis not available or no userContext
      this.broadcastWorkflowLocal(jobId, data);
      return;
    }
    
    const message: SSEWorkflowMessage = {
      jobId,
      data,
      isEndEvent: false,
      userContext
    };
    
    // Publish to user-specific workflow channel
    const channel = getSSEWorkflowChannel(userContext.organizationId, userContext.userId);
    
    this.stateStore.publish(channel, message).catch((error) => {
      logger.error(`Failed to publish workflow broadcast to Redis channel ${channel}`, { 
        component: 'SSEService', 
        jobId
      }, error);
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
   * Send 'end' event to workflow clients via user-scoped Redis Pub/Sub
   */
  sendWorkflowEndEvent(jobId: string, userContext?: UserContext): void {
    if (!this.stateStore || !userContext?.organizationId || !userContext?.userId) {
      this.sendWorkflowEndEventLocal(jobId);
      return;
    }
    
    const message: SSEWorkflowMessage = {
      jobId,
      data: { jobId },
      isEndEvent: true,
      userContext
    };
    
    const channel = getSSEWorkflowChannel(userContext.organizationId, userContext.userId);
    
    this.stateStore.publish(channel, message).catch((error) => {
      logger.error(`Failed to publish workflow end event to Redis channel ${channel}`, { 
        component: 'SSEService', 
        jobId
      }, error);
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
  getClientCount(projectId: string, featureName: string, userContext: UserContext): number {
    if (!userContext?.organizationId || !userContext?.userId) return 0;
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
  closeClients(projectId: string, featureName: string, userContext: UserContext): void {
    if (!userContext?.organizationId || !userContext?.userId) return;
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

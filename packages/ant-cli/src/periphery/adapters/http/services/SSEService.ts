import { Response } from 'express';

/**
 * Message types for unified SSE stream
 */
export type SSEMessageType = 'kanban' | 'chat' | 'fileTree' | 'workflow';

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
  private getSessionKey(projectId: string, featureName: string): string {
    return `${projectId}/${featureName}`;
  }
  
  /**
   * Register SSE client for a project/feature
   */
  registerClient(projectId: string, featureName: string, res: Response): void {
    const key = this.getSessionKey(projectId, featureName);
    
    if (!this.clients.has(key)) {
      this.clients.set(key, new Set());
    }
    
    this.clients.get(key)!.add(res);
    console.log(`[SSEService] Client registered: ${key} (total: ${this.clients.get(key)!.size})`);
    
    // Handle client disconnect
    res.on('close', () => {
      this.clients.get(key)?.delete(res);
      if (this.clients.get(key)?.size === 0) {
        this.clients.delete(key);
      }
      console.log(`[SSEService] Client disconnected: ${key}`);
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
    console.log(`[SSEService] Workflow client registered: ${jobId} (total: ${this.workflowClients.get(jobId)!.size})`);
    
    // Handle client disconnect
    res.on('close', () => {
      this.workflowClients.get(jobId)?.delete(res);
      if (this.workflowClients.get(jobId)?.size === 0) {
        this.workflowClients.delete(jobId);
      }
      console.log(`[SSEService] Workflow client disconnected: ${jobId}`);
    });
  }
  
  /**
   * Broadcast message to project/feature clients
   */
  broadcast(projectId: string, featureName: string, type: SSEMessageType, data: any): void {
    const key = this.getSessionKey(projectId, featureName);
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
        console.error(`[SSEService] Failed to send to client:`, error);
        clients.delete(res);
      }
    });
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
        console.error(`[SSEService] Failed to send workflow to client:`, error);
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
    
    console.log(`[SSEService] Sending 'end' event to ${clients.size} workflow client(s) for job ${jobId}`);
    
    clients.forEach(res => {
      try {
        res.write(`event: end\ndata: ${JSON.stringify({ jobId })}\n\n`);
      } catch (error) {
        console.error(`[SSEService] Failed to send 'end' event to client:`, error);
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
      console.log(`[SSEService] Sent initial ${type} state to client`);
    } catch (error) {
      console.error(`[SSEService] Failed to send initial state:`, error);
    }
  }
  
  /**
   * Get number of connected clients for a project/feature
   */
  getClientCount(projectId: string, featureName: string): number {
    const key = this.getSessionKey(projectId, featureName);
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
  closeClients(projectId: string, featureName: string): void {
    const key = this.getSessionKey(projectId, featureName);
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
      console.log(`[SSEService] Closed all clients for ${key}`);
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
      console.log(`[SSEService] Closed all workflow clients for ${jobId}`);
    }
  }
}


import { Response } from 'express';
import { KanbanService } from './KanbanService';
import { DevServerService } from './DevServerService';
import { ProjectService } from './ProjectService';

/**
 * SSEBroadcastService
 * 
 * Centralized service for managing Server-Sent Events (SSE) broadcasting
 * Handles all real-time updates to connected clients
 */
export class SSEBroadcastService {
  // SSE client connections
  private kanbanSSE: Map<string, Set<Response>> = new Map();
  private devServerSSE: Map<string, Set<Response>> = new Map();
  private fileTreeSSE: Map<string, Set<Response>> = new Map();
  
  constructor(
    private kanbanService: KanbanService,
    private devServerService: DevServerService,
    private projectService: ProjectService
  ) {}
  
  // =====================================
  // Kanban SSE Management
  // =====================================
  
  getKanbanSSE(): Map<string, Set<Response>> {
    return this.kanbanSSE;
  }
  
  async broadcastKanbanUpdate(projectId: string, featureName: string): Promise<void> {
    const key = `${projectId}/${featureName}`;
    const clients = this.kanbanSSE.get(key);
    
    if (!clients || clients.size === 0) {
      return;
    }
    
    try {
      const data = await this.kanbanService.getKanbanData(projectId, featureName);
      const message = `data: ${JSON.stringify(data)}\n\n`;
      
      clients.forEach(res => {
        try {
          res.write(message);
        } catch (error) {
          console.error(`[Kanban SSE] Error sending to client:`, error);
          clients.delete(res);
        }
      });
    } catch (error) {
      console.error(`[Kanban SSE] Error getting Kanban data:`, error);
    }
  }
  
  // =====================================
  // Dev Server SSE Management
  // =====================================
  
  getDevServerSSE(): Map<string, Set<Response>> {
    return this.devServerSSE;
  }
  
  broadcastDevServerStatus(projectId: string): void {
    const clients = this.devServerSSE.get(projectId);
    
    if (!clients || clients.size === 0) {
      return;
    }
    
    // Get status directly from service
    const status = this.devServerService.getDevServerStatus(projectId);
    const logs = this.devServerService.getDevServerLogs(projectId);
    
    const fullStatus = {
      running: status.running,
      port: status.port || null,
      url: status.port ? `http://localhost:${status.port}` : null,
      logs: logs.slice(-50)
    };
    
    const message = `data: ${JSON.stringify(fullStatus)}\n\n`;
    
    clients.forEach(res => {
      try {
        res.write(message);
      } catch (error) {
        console.error(`[DevServer SSE] Error sending to client:`, error);
        clients.delete(res);
      }
    });
  }
  
  // =====================================
  // File Tree SSE Management
  // =====================================
  
  getFileTreeSSE(): Map<string, Set<Response>> {
    return this.fileTreeSSE;
  }
  
  async broadcastFileTreeUpdate(projectId: string, featureName: string): Promise<void> {
    const key = `${projectId}/${featureName}`;
    const clients = this.fileTreeSSE.get(key);
    
    if (!clients || clients.size === 0) {
      console.log(`  ℹ️  No file tree SSE clients for ${key}`);
      return;
    }
    
    try {
      // Fetch updated file tree from ProjectService
      const fileTree = await this.projectService.getFileTree(projectId, featureName);
      const message = `data: ${JSON.stringify({ type: 'update', fileTree })}\n\n`;
      
      console.log(`  📡 Broadcasting to ${clients.size} client(s)`);
      
      clients.forEach(res => {
        try {
          res.write(message);
        } catch (error) {
          console.error(`[FileTree SSE] Error sending to client:`, error);
          clients.delete(res);
        }
      });
    } catch (error) {
      console.error(`[FileTree SSE] Error getting file tree:`, error);
    }
  }
  
  // =====================================
  // Cleanup
  // =====================================
  
  cleanup(): void {
    // Close all Kanban SSE connections
    this.kanbanSSE.forEach((clients) => {
      clients.forEach(res => {
        try {
          res.end();
        } catch (err) {
          // Ignore errors from already closed connections
        }
      });
    });
    this.kanbanSSE.clear();
    
    // Close all Dev Server SSE connections
    this.devServerSSE.forEach((clients) => {
      clients.forEach(res => {
        try {
          res.end();
        } catch (err) {
          // Ignore errors
        }
      });
    });
    this.devServerSSE.clear();
    
    // Close all File Tree SSE connections
    this.fileTreeSSE.forEach((clients) => {
      clients.forEach(res => {
        try {
          res.end();
        } catch (err) {
          // Ignore errors
        }
      });
    });
    this.fileTreeSSE.clear();
  }
}


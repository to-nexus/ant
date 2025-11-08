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
  
  async broadcastKanbanUpdate(
    projectId: string, 
    featureName: string,
    jobToProject?: Map<string, { projectId: string; featureName: string }>,
    jobs?: Map<string, any>,
    taskQueueSnapshots?: Map<string, any>,
    jobType?: 'design' | 'code' | 'learn'  // ✅ Add jobType parameter
  ): Promise<void> {
    const key = `${projectId}/${featureName}`;
    const clients = this.kanbanSSE.get(key);
    
    console.log(`\n📡 [SSEBroadcast] broadcastKanbanUpdate called`);
    console.log(`   Key: ${key}`);
    console.log(`   Clients: ${clients?.size || 0}`);
    console.log(`   Has jobToProject: ${!!jobToProject}`);
    console.log(`   Has jobs: ${!!jobs}`);
    console.log(`   Has snapshots: ${!!taskQueueSnapshots}`);
    console.log(`   Job type: ${jobType || 'not specified'}`);
    
    if (!clients || clients.size === 0) {
      console.log(`   ⚠️  No clients connected, skipping broadcast\n`);
      return;
    }
    
    try {
      // Determine job type: use provided or infer from active job
      let finalJobType: 'design' | 'code' | 'learn' = jobType || 'code';
      
      if (!jobType && jobToProject && jobs) {
        // Try to infer job type from active job
        for (const [jobId, mapping] of jobToProject.entries()) {
          if (mapping.projectId === projectId && mapping.featureName === featureName) {
            const jobStatus = jobs.get(jobId);
            if (jobStatus && jobStatus.task) {
              finalJobType = jobStatus.task;
              console.log(`   ℹ️  Inferred job type from active job: ${finalJobType}`);
              break;
            }
          }
        }
      }
      
      // ✅ CRITICAL: Pass all required parameters including jobType to getKanbanData
      const data = await this.kanbanService.getKanbanData(
        projectId, 
        featureName,
        finalJobType,  // ✅ Pass job type
        jobToProject,
        jobs,
        taskQueueSnapshots
      );
      
      console.log(`   ✅ Kanban data retrieved:`, {
        dataSource: data.dataSource,
        isEstimating: data.isEstimating,
        activeJobId: data.activeJobId
      });
      
      const message = `data: ${JSON.stringify(data)}\n\n`;
      
      clients.forEach(res => {
        try {
          res.write(message);
        } catch (error) {
          console.error(`[Kanban SSE] Error sending to client:`, error);
          clients.delete(res);
        }
      });
      
      console.log(`   ✅ Broadcast completed to ${clients.size} client(s)\n`);
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
    
    console.log(`[SSEBroadcastService] 📡 broadcastFileTreeUpdate: ${key}`);
    console.log(`[SSEBroadcastService]    Connected clients: ${clients?.size || 0}`);
    
    if (!clients || clients.size === 0) {
      console.log(`[SSEBroadcastService] ⚠️  No clients connected for ${key} - skipping broadcast`);
      return;
    }
    
    try {
      // Fetch updated file tree from ProjectService
      console.log(`[SSEBroadcastService] 📂 Fetching file tree from ProjectService...`);
      const fileTree = await this.projectService.getFileTree(projectId, featureName);
      console.log(`[SSEBroadcastService] ✅ File tree fetched: ${fileTree.length} items`);
      
      const message = `data: ${JSON.stringify({ type: 'update', fileTree })}\n\n`;
      
      let successCount = 0;
      clients.forEach(res => {
        try {
          res.write(message);
          successCount++;
        } catch (error) {
          console.error(`[FileTree SSE] Error sending to client:`, error);
          clients.delete(res);
        }
      });
      
      console.log(`[SSEBroadcastService] ✅ File tree update sent to ${successCount}/${clients.size} clients`);
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


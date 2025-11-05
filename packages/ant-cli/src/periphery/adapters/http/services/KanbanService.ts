import { Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';

/**
 * KanbanService
 * 
 * Manages Kanban board state and SSE broadcasts for real-time task tracking.
 * Implements hybrid data strategy: live memory snapshots + session file fallback.
 */
export class KanbanService {
  private readonly workspaceRoot: string;
  
  // Real-time queue tracking (direct from state, not parsed)
  private taskQueueSnapshots: Map<string, { 
    currentTask: any; 
    queue: any[];
    recursionCount?: number;
    recursionLimit?: number;
  }> = new Map();
  
  // Task to project/feature mapping
  private taskToProject: Map<string, { projectId: string; featureName: string }> = new Map();
  
  // Kanban SSE tracking - key: "projectId/featureName"
  private kanbanSSE: Map<string, Set<Response>> = new Map();
  
  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
  }
  
  /**
   * Update task queue snapshot (called by orchestrator during execution)
   * This provides real-time queue data without parsing logs
   */
  updateTaskQueue(
    taskId: string, 
    currentTask: any, 
    queue: any[],
    recursionCount?: number,
    recursionLimit?: number
  ): void {
    const isFirstUpdate = !this.taskQueueSnapshots.has(taskId);
    
    this.taskQueueSnapshots.set(taskId, { 
      currentTask, 
      queue,
      recursionCount,
      recursionLimit
    });
    
    if (isFirstUpdate) {
      console.log(`[Task Queue] 🎬 INITIAL registration for ${taskId}: current="${currentTask?.name}", queue=${queue.length}, recursion=${recursionCount}/${recursionLimit}`);
    } else {
      console.log(`[Task Queue] 🔄 Updated snapshot for ${taskId}: current="${currentTask?.name}", queue=${queue.length}, recursion=${recursionCount}/${recursionLimit}`);
    }
    
    // Broadcast update to Kanban SSE clients
    this.broadcastKanbanForTask(taskId);
  }
  
  /**
   * Register task to project/feature mapping
   */
  registerTask(taskId: string, projectId: string, featureName: string): void {
    this.taskToProject.set(taskId, { projectId, featureName });
  }
  
  /**
   * Unregister task mapping
   */
  unregisterTask(taskId: string): void {
    this.taskToProject.delete(taskId);
    this.taskQueueSnapshots.delete(taskId);
  }
  
  /**
   * Add Kanban SSE client
   */
  addSSEClient(projectId: string, featureName: string, res: Response): void {
    const key = `${projectId}/${featureName}`;
    if (!this.kanbanSSE.has(key)) {
      this.kanbanSSE.set(key, new Set());
    }
    this.kanbanSSE.get(key)!.add(res);
    console.log(`[Kanban SSE] Client connected for ${key}, total clients: ${this.kanbanSSE.get(key)!.size}`);
  }
  
  /**
   * Remove Kanban SSE client
   */
  removeSSEClient(projectId: string, featureName: string, res: Response): void {
    const key = `${projectId}/${featureName}`;
    const clients = this.kanbanSSE.get(key);
    if (clients) {
      clients.delete(res);
      if (clients.size === 0) {
        this.kanbanSSE.delete(key);
      }
    }
  }
  
  /**
   * Close all Kanban SSE connections for a project/feature
   */
  closeSSEConnections(projectId: string, featureName: string): void {
    const key = `${projectId}/${featureName}`;
    const kanbanClients = this.kanbanSSE.get(key);
    if (kanbanClients) {
      console.log(`[Kanban SSE] Closing ${kanbanClients.size} connections for ${key}`);
      kanbanClients.forEach(res => {
        try {
          res.end();
        } catch (err) {
          // Ignore errors from already closed connections
        }
      });
      this.kanbanSSE.delete(key);
    }
  }
  
  /**
   * Broadcast Kanban update for a specific task
   */
  private broadcastKanbanForTask(taskId: string): void {
    const mapping = this.taskToProject.get(taskId);
    if (!mapping) {
      return;
    }
    
    const { projectId, featureName } = mapping;
    const key = `${projectId}/${featureName}`;
    const clients = this.kanbanSSE.get(key);
    
    if (!clients || clients.size === 0) {
      return;
    }
    
    // Get Kanban data
    this.getKanbanData(projectId, featureName, taskId).then(data => {
      const message = `data: ${JSON.stringify(data)}\n\n`;
      
      clients.forEach(res => {
        try {
          res.write(message);
        } catch (error) {
          console.error(`[Kanban SSE] Error sending to client:`, error);
          clients.delete(res);
        }
      });
    }).catch(error => {
      console.error(`[Kanban SSE] Error getting Kanban data:`, error);
    });
  }
  
  /**
   * Broadcast Kanban update to all clients for a project/feature
   */
  async broadcastKanban(projectId: string, featureName: string, activeTaskId?: string): Promise<void> {
    const key = `${projectId}/${featureName}`;
    const clients = this.kanbanSSE.get(key);
    
    if (!clients || clients.size === 0) {
      return;
    }
    
    const data = await this.getKanbanData(projectId, featureName, activeTaskId);
    const message = `data: ${JSON.stringify(data)}\n\n`;
    
    clients.forEach(res => {
      try {
        res.write(message);
      } catch (error) {
        console.error(`[Kanban SSE] Error sending to client:`, error);
        clients.delete(res);
      }
    });
  }
  
  /**
   * Get Kanban data with hybrid strategy: live snapshot > session fallback
   */
  private async getKanbanData(
    projectId: string,
    featureName: string,
    activeTaskId?: string
  ): Promise<any> {
    // Priority 1: Live snapshot (real-time memory state)
    if (activeTaskId) {
      const liveSnapshot = this.taskQueueSnapshots.get(activeTaskId);
      if (liveSnapshot) {
        console.log(`[Kanban] Using live snapshot for ${activeTaskId}`);
        return {
          currentTask: liveSnapshot.currentTask,
          taskQueue: liveSnapshot.queue,
          completedTasks: [], // Will be loaded from session
          source: 'live',
          recursionCount: liveSnapshot.recursionCount || 0,
          recursionLimit: liveSnapshot.recursionLimit || 50
        };
      }
    }
    
    // Priority 2: Session file (persistent state)
    const sessionPath = path.join(
      this.workspaceRoot,
      projectId,
      featureName,
      'outputs/session.json'
    );
    
    try {
      if (fs.existsSync(sessionPath)) {
        const sessionData = JSON.parse(fs.readFileSync(sessionPath, 'utf-8'));
        const state = sessionData.state || {};
        
        console.log(`[Kanban] Using session data for ${projectId}/${featureName}`);
        console.log(`[Kanban] Session pausedDueToLimit:`, state.pausedDueToLimit);
        console.log(`[Kanban] Session tasksRemaining:`, state.tasksRemaining);
        console.log(`[Kanban] Session recursionCount:`, state.recursionCount);
        console.log(`[Kanban] Session recursionLimit:`, state.recursionLimit);
        return {
          currentTask: state.currentTask || null,
          taskQueue: state.taskQueue || [],
          completedTasks: state.completedTasksDetails || [],
          source: 'session',
          pausedDueToLimit: state.pausedDueToLimit || false,
          tasksRemaining: state.tasksRemaining || 0,
          recursionCount: state.recursionCount,
          recursionLimit: state.recursionLimit
        };
      }
    } catch (error) {
      console.error(`[Kanban] Error reading session file:`, error);
    }
    
    // Priority 3: Empty state (task not started or no data yet)
    console.log(`[Kanban] No data available for ${projectId}/${featureName}`);
    return {
      currentTask: null,
      taskQueue: [],
      completedTasks: [],
      source: 'empty',
      estimating: activeTaskId ? true : false // If task is running but no data, it's estimating
    };
  }
  
  /**
   * Get Kanban data for HTTP endpoint
   */
  async getKanbanDataForEndpoint(projectId: string, featureName: string): Promise<any> {
    // Find active task for this project/feature
    let activeTaskId: string | undefined;
    for (const [taskId, mapping] of this.taskToProject.entries()) {
      if (mapping.projectId === projectId && mapping.featureName === featureName) {
        activeTaskId = taskId;
        break;
      }
    }
    
    return this.getKanbanData(projectId, featureName, activeTaskId);
  }
}

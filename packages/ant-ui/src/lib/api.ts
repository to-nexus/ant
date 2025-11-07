/// <reference types="vite/client" />

import { Session } from '@/types/session';
import { LogEntry } from '@/types/log';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:4100/api';

console.log('[API] API_BASE:', API_BASE);
console.log('[API] Environment variables:', import.meta.env);

export interface ExecuteJobParams {
  projectId: string;
  featureName?: string;  // Optional: if not provided, uses 'skeleton'
  task?: 'design' | 'code' | 'learn' | 'review' | 'plan' | 'doc';  // Note: 'task' here means agent's work type
  agent?: 'architect' | 'reviewer' | 'planner' | 'doc';
  mode?: 'generate' | 'refactor' | 'explain';
  language?: string;
}

export interface JobStatus {
  jobId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

export interface Feature {
  name: string;
  path: string;
  createdAt?: string;
}

export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileNode[];
}

export interface FileContent {
  path: string;
  content: string;
}

export interface AgentTask {
  value: string;
  label: string;
}

export interface Agent {
  value: string;
  label: string;
  enabled: boolean;
  tasks: AgentTask[];
}

export interface DevServerStatus {
  running: boolean;
  port: number | null;
  url: string | null;
  logs: LogEntry[];
}

// Health check function to verify API connection
export async function checkHealth(): Promise<boolean> {
  try {
    const url = `${API_BASE}/health`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });
    
    if (!response.ok) {
      return false;
    }
    
    const data = await response.json();
    return data.status === 'ok';
  } catch (error) {
    console.error('Health check failed:', error);
    return false;
  }
}

export async function fetchProjects(): Promise<string[]> {
  try {
    const url = `${API_BASE}/projects`;
    console.log('[API] Fetching projects from:', url);
    const response = await fetch(url);
    
    console.log('[API] Response status:', response.status);
    console.log('[API] Response headers:', Object.fromEntries(response.headers.entries()));
    
    if (!response.ok) {
      throw new Error(`Failed to fetch projects: ${response.statusText}`);
    }
    
    const data = await response.json();
    console.log('[API] Projects data received:', data);
    return data;
  } catch (error) {
    console.error('Error fetching projects:', error);
    throw error;
  }
}

export async function fetchAgents(): Promise<Agent[]> {
  try {
    const url = `${API_BASE}/agents`;
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`Failed to fetch agents: ${response.statusText}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('Error fetching agents:', error);
    throw error;
  }
}

export async function createProject(projectId: string): Promise<void> {
  try {
    const url = `${API_BASE}/projects`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ id: projectId }),
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || `Failed to create project: ${response.statusText}`);
    }
  } catch (error) {
    console.error('Error creating project:', error);
    throw error;
  }
}

export async function deleteProject(projectId: string): Promise<void> {
  try {
    const url = `${API_BASE}/projects/${encodeURIComponent(projectId)}`;
    const response = await fetch(url, {
      method: 'DELETE',
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || `Failed to delete project: ${response.statusText}`);
    }
  } catch (error) {
    console.error('Error deleting project:', error);
    throw error;
  }
}

export async function fetchSession(projectId: string): Promise<Session | null> {
  try {
    const response = await fetch(`${API_BASE}/projects/${encodeURIComponent(projectId)}/session`);
    
    if (response.status === 404) {
      return null;
    }
    
    if (!response.ok) {
      throw new Error(`Failed to fetch session: ${response.statusText}`);
    }
    
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error fetching session:', error);
    throw error;
  }
}

export async function executeJob(params: ExecuteJobParams): Promise<{ jobId: string }> {
  try {
    const { 
      projectId, 
      featureName = 'skeleton',  // Default to skeleton for backward compatibility
      task = 'code', 
      agent, 
      mode = 'generate', 
      language = 'en' 
    } = params;
    
    const requestBody = {
      task,
      agent,
      mode,
      language,
    };
    
    // Use feature-specific endpoint if feature provided
    const endpoint = featureName 
      ? `${API_BASE}/projects/${encodeURIComponent(projectId)}/features/${encodeURIComponent(featureName)}/execute`
      : `${API_BASE}/projects/${encodeURIComponent(projectId)}/execute`;
    
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });
    
    if (!response.ok) {
      throw new Error(`Failed to execute task: ${response.statusText}`);
    }
    
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error executing task:', error);
    throw error;
  }
}

export async function stopJob(jobId: string, projectId?: string, featureName?: string): Promise<void> {
  try {
    const response = await fetch(`${API_BASE}/jobs/${encodeURIComponent(jobId)}/stop`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ projectId, featureName }),  // ✅ Send project info
    });
    
    if (!response.ok) {
      throw new Error(`Failed to stop task: ${response.statusText}`);
    }
    
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error stopping task:', error);
    throw error;
  }
}

export interface QueueStatus {
  currentTask: {
    name: string;
    type: string;
    status: string;
    timing?: {
      startedAt?: string;
      completedAt?: string;
      pausedAt?: string;
      resumedAt?: string;
      totalPausedDuration: number;
      elapsedTime?: number;
    };
  } | null;
  queue: Array<{
    name: string;
    type: string;
    status: string;
    timing?: {
      startedAt?: string;
      completedAt?: string;
      pausedAt?: string;
      resumedAt?: string;
      totalPausedDuration: number;
      elapsedTime?: number;
    };
  }>;
  totalRemaining: number;
  estimatingMessage?: string | null;
}

export async function fetchQueueStatus(jobId: string): Promise<QueueStatus> {
  try {
    const response = await fetch(`${API_BASE}/tasks/${encodeURIComponent(jobId)}/queue`);
    
    if (!response.ok) {
      throw new Error(`Failed to fetch queue status: ${response.statusText}`);
    }
    
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error fetching queue status:', error);
    throw error;
  }
}

export function subscribeToLogs(jobId: string, onLog: (log: LogEntry) => void): EventSource {
  const eventSource = new EventSource(`${API_BASE}/jobs/${encodeURIComponent(jobId)}/stream`);
  
  eventSource.onmessage = (event) => {
    try {
      const log: LogEntry = JSON.parse(event.data);
      onLog(log);
    } catch (error) {
      console.error('Error parsing log entry:', error);
    }
  };
  
  eventSource.onerror = (error) => {
    console.error('EventSource error:', error);
    eventSource.close();
  };
  
  return eventSource;
}

export async function fetchJobStatus(jobId: string): Promise<JobStatus> {
  try {
    const response = await fetch(`${API_BASE}/tasks/${encodeURIComponent(jobId)}/status`);
    
    if (!response.ok) {
      throw new Error(`Failed to fetch task status: ${response.statusText}`);
    }
    
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error fetching task status:', error);
    throw error;
  }
}

// ========== Feature Management ==========

export async function fetchFeatures(projectId: string): Promise<Feature[]> {
  try {
    const response = await fetch(`${API_BASE}/projects/${encodeURIComponent(projectId)}/features`);
    
    if (!response.ok) {
      throw new Error(`Failed to fetch features: ${response.statusText}`);
    }
    
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error fetching features:', error);
    throw error;
  }
}

export async function createFeature(projectId: string, featureName: string): Promise<void> {
  try {
    const response = await fetch(`${API_BASE}/projects/${encodeURIComponent(projectId)}/features`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ featureName }),
    });
    
    if (!response.ok) {
      throw new Error(`Failed to create feature: ${response.statusText}`);
    }
  } catch (error) {
    console.error('Error creating feature:', error);
    throw error;
  }
}

export async function deleteFeature(projectId: string, featureName: string): Promise<void> {
  try {
    const response = await fetch(
      `${API_BASE}/projects/${encodeURIComponent(projectId)}/features/${encodeURIComponent(featureName)}`,
      { method: 'DELETE' }
    );
    
    if (!response.ok) {
      throw new Error(`Failed to delete feature: ${response.statusText}`);
    }
  } catch (error) {
    console.error('Error deleting feature:', error);
    throw error;
  }
}

export async function fetchFeatureSession(projectId: string, featureName: string): Promise<Session | null> {
  try {
    const url = `${API_BASE}/projects/${encodeURIComponent(projectId)}/features/${encodeURIComponent(featureName)}/session`;
    const response = await fetch(url);
    
    if (response.status === 404) {
      return null;
    }
    
    if (!response.ok) {
      throw new Error(`Failed to fetch feature session: ${response.statusText}`);
    }
    
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error fetching feature session:', error);
    throw error;
  }
}

// ========================================
// 📊 KANBAN API - Complete View Model
// ========================================
export interface KanbanTask {
  id: string;
  name: string;
  type: 'setup' | 'feature' | 'integration' | 'unknown';
  description?: string;
  priority?: number;
  status?: 'todo' | 'in-progress' | 'completed';
  completed?: boolean;
  timing?: {
    startedAt?: string;
    completedAt?: string;
    pausedAt?: string;
    resumedAt?: string;
    totalPausedDuration: number;
    elapsedTime?: number;
  };
}

export interface KanbanData {
  todo: KanbanTask[];
  inProgress: KanbanTask | null;
  completed: KanbanTask[];
  isEstimating?: boolean;  // Task running but no queue data yet
  dataSource?: 'live' | 'session' | 'estimating';  // Where the data comes from
  
  // ✅ Unified interruption state
  interruption?: import('@/types/session').InterruptionDetails;
  
  // Recursion Tracking
  recursionCount?: number;
  recursionLimit?: number;
}

/**
 * Fetch complete Kanban board data for a feature
 * Returns ready-to-render data (no client-side merging needed)
 */
export async function fetchKanbanData(projectId: string, featureName: string): Promise<KanbanData> {
  try {
    const url = `${API_BASE}/projects/${encodeURIComponent(projectId)}/features/${encodeURIComponent(featureName)}/kanban`;
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`Failed to fetch kanban data: ${response.statusText}`);
    }
    
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error fetching kanban data:', error);
    // Return empty kanban on error
    return {
      todo: [],
      inProgress: null,
      completed: []
    };
  }
}

// ========== File Management ==========

export async function fetchFileTree(projectId: string, featureName: string): Promise<FileNode[]> {
  try {
    const response = await fetch(
      `${API_BASE}/projects/${encodeURIComponent(projectId)}/features/${encodeURIComponent(featureName)}/files`
    );
    
    if (!response.ok) {
      throw new Error(`Failed to fetch file tree: ${response.statusText}`);
    }
    
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error fetching file tree:', error);
    throw error;
  }
}

export async function fetchFileContent(
  projectId: string,
  featureName: string,
  filePath: string
): Promise<FileContent> {
  try {
    const response = await fetch(
      `${API_BASE}/projects/${encodeURIComponent(projectId)}/features/${encodeURIComponent(featureName)}/files/${filePath}`
    );
    
    if (!response.ok) {
      throw new Error(`Failed to fetch file content: ${response.statusText}`);
    }
    
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error fetching file content:', error);
    throw error;
  }
}

export async function saveFileContent(
  projectId: string,
  featureName: string,
  filePath: string,
  content: string
): Promise<void> {
  try {
    const response = await fetch(
      `${API_BASE}/projects/${encodeURIComponent(projectId)}/features/${encodeURIComponent(featureName)}/files/${filePath}`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content }),
      }
    );
    
    if (!response.ok) {
      throw new Error(`Failed to save file content: ${response.statusText}`);
    }
  } catch (error) {
    console.error('Error saving file content:', error);
    throw error;
  }
}

// Create a new empty file
export async function createFile(
  projectId: string,
  featureName: string,
  filePath: string,
  content: string = ''
): Promise<void> {
  try {
    const response = await fetch(
      `${API_BASE}/projects/${encodeURIComponent(projectId)}/features/${encodeURIComponent(featureName)}/files/${filePath}`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content }),
      }
    );
    
    if (!response.ok) {
      throw new Error(`Failed to create file: ${response.statusText}`);
    }
  } catch (error) {
    console.error('Error creating file:', error);
    throw error;
  }
}

// Upload files (using FormData for binary files)
export async function uploadFiles(
  projectId: string,
  featureName: string,
  dirPath: string,
  files: FileList
): Promise<void> {
  try {
    const formData = new FormData();
    Array.from(files).forEach((file) => {
      formData.append('files', file);
    });
    formData.append('dirPath', dirPath);

    const response = await fetch(
      `${API_BASE}/projects/${encodeURIComponent(projectId)}/features/${encodeURIComponent(featureName)}/upload`,
      {
        method: 'POST',
        body: formData,
      }
    );
    
    if (!response.ok) {
      throw new Error(`Failed to upload files: ${response.statusText}`);
    }
  } catch (error) {
    console.error('Error uploading files:', error);
    throw error;
  }
}

// Delete a file or directory
export async function deleteFileOrDirectory(
  projectId: string,
  featureName: string,
  filePath: string
): Promise<void> {
  try {
    const url = `${API_BASE}/projects/${encodeURIComponent(projectId)}/features/${encodeURIComponent(featureName)}/item`;
    
    const response = await fetch(url, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ path: filePath }),
    });
    
    if (!response.ok) {
      throw new Error(`Failed to delete: ${response.statusText}`);
    }
  } catch (error) {
    console.error('Error deleting file/directory:', error);
    throw error;
  }
}

// Create a new directory
export async function createDirectory(
  projectId: string,
  featureName: string,
  dirPath: string
): Promise<void> {
  try {
    const response = await fetch(
      `${API_BASE}/projects/${encodeURIComponent(projectId)}/features/${encodeURIComponent(featureName)}/directories`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ dirPath }),
      }
    );
    
    if (!response.ok) {
      throw new Error(`Failed to create directory: ${response.statusText}`);
    }
  } catch (error) {
    console.error('Error creating directory:', error);
    throw error;
  }
}

// Config types
export interface ProjectConfig {
  projectName: string;
  repoType?: 'local' | 'github';
  localPath?: string;
  githubRepo?: string;
  branchBase: string;
  autoLearn: boolean;
  strictValidation?: boolean;
  llmProvider?: string;
  llmModel?: string;
}

// Fetch project config
export async function fetchProjectConfig(projectId: string): Promise<ProjectConfig | null> {
  try {
    const response = await fetch(
      `${API_BASE}/projects/${encodeURIComponent(projectId)}/config`
    );
    
    if (response.status === 404) {
      return null; // Config doesn't exist
    }
    
    if (!response.ok) {
      throw new Error(`Failed to fetch config: ${response.statusText}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('Error fetching config:', error);
    throw error;
  }
}

// Sanitize workspace ID to valid project name (alphanumeric + hyphens)
function sanitizeProjectName(workspaceId: string): string {
  return workspaceId
    .toLowerCase()
    .replace(/\s+/g, '-')           // spaces → hyphens
    .replace(/[^a-z0-9-]/g, '')     // remove non-alphanumeric except hyphens
    .replace(/-+/g, '-')            // multiple hyphens → single hyphen
    .replace(/^-+|-+$/g, '');       // trim leading/trailing hyphens
}

// Create project config with defaults
export async function createProjectConfig(projectId: string): Promise<ProjectConfig> {
  const sanitizedName = sanitizeProjectName(projectId);
  
  const defaultConfig: ProjectConfig = {
    projectName: sanitizedName,
    repoType: 'local',
    localPath: `~/dev/${sanitizedName}`,
    branchBase: 'main',
    autoLearn: true,
  };
  
  try {
    const response = await fetch(
      `${API_BASE}/projects/${encodeURIComponent(projectId)}/config`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(defaultConfig),
      }
    );
    
    if (!response.ok) {
      throw new Error(`Failed to create config: ${response.statusText}`);
    }
    
    return defaultConfig;
  } catch (error) {
    console.error('Error creating config:', error);
    throw error;
  }
}

// Update project config
export async function updateProjectConfig(projectId: string, config: ProjectConfig): Promise<ProjectConfig> {
  try {
    const response = await fetch(
      `${API_BASE}/projects/${encodeURIComponent(projectId)}/config`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(config),
      }
    );
    
    if (!response.ok) {
      throw new Error(`Failed to update config: ${response.statusText}`);
    }
    
    // Backend now returns the saved config
    return await response.json();
  } catch (error) {
    console.error('Error updating config:', error);
    throw error;
  }
}

// Dev server management
export async function startDevServer(projectId: string): Promise<{ success: boolean; message: string; script: string }> {
  try {
    const response = await fetch(
      `${API_BASE}/projects/${encodeURIComponent(projectId)}/dev/start`,
      {
        method: 'POST',
      }
    );
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || `Failed to start dev server: ${response.statusText}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('Error starting dev server:', error);
    throw error;
  }
}

export async function stopDevServer(projectId: string): Promise<{ success: boolean; message: string }> {
  try {
    const response = await fetch(
      `${API_BASE}/projects/${encodeURIComponent(projectId)}/dev/stop`,
      {
        method: 'POST',
      }
    );
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || `Failed to stop dev server: ${response.statusText}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('Error stopping dev server:', error);
    throw error;
  }
}

export async function getDevServerStatus(projectId: string): Promise<DevServerStatus> {
  try {
    const response = await fetch(
      `${API_BASE}/projects/${encodeURIComponent(projectId)}/dev/status`
    );
    
    if (!response.ok) {
      throw new Error(`Failed to get dev server status: ${response.statusText}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('Error getting dev server status:', error);
    throw error;
  }
}

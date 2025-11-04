/// <reference types="vite/client" />

import { Session } from '@/types/session';
import { LogEntry } from '@/types/log';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:4100/api';

console.log('[API] API_BASE:', API_BASE);
console.log('[API] Environment variables:', import.meta.env);

export interface ExecuteTaskParams {
  projectId: string;
  task?: 'design' | 'code' | 'learn' | 'review' | 'plan' | 'doc';
  agent?: 'architect' | 'reviewer' | 'planner' | 'doc';
  mode?: 'generate' | 'refactor' | 'explain';
  language?: string;
}

export interface TaskStatus {
  taskId: string;
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

// Health check function to verify API connection
export async function checkHealth(): Promise<boolean> {
  try {
    const url = `${API_BASE.replace('/api', '')}/health`;
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

export async function executeTask(params: ExecuteTaskParams): Promise<{ taskId: string }> {
  try {
    const { projectId, task = 'code', agent, mode = 'generate', language = 'en' } = params;
    
    const requestBody = {
      task,
      agent,
      mode,
      language,
    };
    
    const response = await fetch(`${API_BASE}/projects/${encodeURIComponent(projectId)}/execute`, {
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

export function subscribeToLogs(taskId: string, onLog: (log: LogEntry) => void): EventSource {
  const eventSource = new EventSource(`${API_BASE}/tasks/${encodeURIComponent(taskId)}/stream`);
  
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

export async function fetchTaskStatus(taskId: string): Promise<TaskStatus> {
  try {
    const response = await fetch(`${API_BASE}/tasks/${encodeURIComponent(taskId)}/status`);
    
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

import { executeTask, subscribeToLogs, stopTask } from '@/lib/api';
import { useStore } from '@/lib/store';

export interface ExecuteCodeTaskOptions {
  projectId?: string;
  task?: 'design' | 'code' | 'learn' | 'review' | 'plan' | 'doc';
  agent?: 'architect' | 'reviewer' | 'planner' | 'doc';
  mode?: 'generate' | 'refactor' | 'explain';
  language?: string;
  cwd?: string;
}

export interface TaskExecution {
  taskId: string;
  eventSource: EventSource;
  kill: (signal?: string) => Promise<boolean>;
  on: (event: 'exit', listener: (code: number | null, signal: string | null) => void) => TaskExecution;
  onTaskIdReady?: (callback: (taskId: string) => void) => void;
}

export function executeCodeTask(options: ExecuteCodeTaskOptions = {}): TaskExecution {
  const { 
    projectId = '', 
    task = 'code',
    agent = 'architect',
    mode = 'generate',
    language = 'en' 
  } = options;
  
  const store = useStore.getState();
  
  let eventSource: EventSource | null = null;
  let taskId = '';
  let exitListener: ((code: number | null, signal: string | null) => void) | null = null;
  let taskIdReadyCallback: ((taskId: string) => void) | null = null;
  
  const taskExecution: TaskExecution = {
    taskId: '',
    eventSource: null as unknown as EventSource,
    kill: async (_signal?: string) => {
      try {
        // Stop the task on the server first
        if (taskId) {
          await stopTask(taskId);
        }
      } catch (error) {
        console.error('Error stopping task on server:', error);
      } finally {
        // Always close the event source and notify listener
        if (eventSource) {
          eventSource.close();
          
          if (exitListener) {
            exitListener(0, 'SIGTERM');
          }
        }
      }
      return true;
    },
    on: (event: 'exit', listener: (code: number | null, signal: string | null) => void) => {
      if (event === 'exit') {
        exitListener = listener;
      }
      return taskExecution;
    },
    // Add method to set callback for when taskId is ready
    onTaskIdReady: (callback: (taskId: string) => void) => {
      taskIdReadyCallback = callback;
      if (taskId) {
        // If taskId is already available, call immediately
        callback(taskId);
      }
    }
  };
  
  executeTask({
    projectId,
    task,
    agent,
    mode,
    language,
  })
    .then((response) => {
      taskId = response.taskId;
      taskExecution.taskId = taskId;
      
      // Notify that taskId is ready
      if (taskIdReadyCallback) {
        taskIdReadyCallback(taskId);
      }
      
      // SSE 연결 - 실제 작업 로그만 스트리밍
      eventSource = subscribeToLogs(taskId, (log) => {
        // Check for completion markers
        if (log.message === '__TASK_COMPLETED__') {
          // Task completed successfully
          eventSource?.close();
          if (exitListener) {
            exitListener(0, null);
          }
          return;
        }
        
        if (log.message === '__TASK_FAILED__') {
          // Task failed
          eventSource?.close();
          if (exitListener) {
            exitListener(1, null);
          }
          return;
        }
        
        // Normal log message
        store.addLog(log);
      });
      
      taskExecution.eventSource = eventSource;
      
      eventSource.addEventListener('error', () => {
        store.addLog({
          type: 'error',
          message: 'Connection to log stream lost',
          timestamp: new Date().toISOString(),
        });
        
        if (exitListener) {
          exitListener(1, null);
        }
      });
      
      eventSource.addEventListener('close', () => {
        if (exitListener) {
          exitListener(0, null);
        }
      });
    })
    .catch((error) => {
      store.addLog({
        type: 'error',
        message: `Failed to start task: ${error.message}`,
        timestamp: new Date().toISOString(),
      });
      
      if (exitListener) {
        exitListener(1, null);
      }
    });
  
  return taskExecution;
}
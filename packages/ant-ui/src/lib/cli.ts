import { executeJob, subscribeToLogs, stopJob } from '@/lib/api';
import { useStore } from '@/lib/store';

export interface ExecuteCodeJobOptions {
  projectId?: string;
  featureName?: string;  // Which feature to execute for
  task?: 'design' | 'code' | 'learn' | 'review' | 'plan' | 'doc';  // Note: 'task' here means agent's work type
  agent?: 'architect' | 'reviewer' | 'planner' | 'doc';
  mode?: 'generate' | 'refactor' | 'explain';
  language?: string;
  cwd?: string;
}

export interface JobExecution {
  jobId: string;
  eventSource: EventSource;
  kill: (signal?: string) => Promise<boolean>;
  on: (event: 'exit', listener: (code: number | null, signal: string | null) => void) => JobExecution;
  onJobIdReady?: (callback: (jobId: string) => void) => void;
}

export function executeCodeJob(options: ExecuteCodeJobOptions = {}): JobExecution {
  const { 
    projectId = '', 
    featureName = 'skeleton',  // Default to skeleton
    task = 'code',
    agent = 'architect',
    mode = 'generate',
    language = 'en' 
  } = options;
  
  const store = useStore.getState();
  
  let eventSource: EventSource | null = null;
  let jobId = '';
  let exitListener: ((code: number | null, signal: string | null) => void) | null = null;
  let jobIdReadyCallback: ((jobId: string) => void) | null = null;
  
  const taskExecution: JobExecution = {
    jobId: '',
    eventSource: null as unknown as EventSource,
    kill: async (_signal?: string) => {
      try {
        // Stop the task on the server first
        if (jobId) {
          await stopTask(jobId);
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
    // Add method to set callback for when jobId is ready
    onTaskIdReady: (callback: (jobId: string) => void) => {
      jobIdReadyCallback = callback;
      if (jobId) {
        // If jobId is already available, call immediately
        callback(jobId);
      }
    }
  };
  
  executeTask({
    projectId,
    featureName,
    task,
    agent,
    mode,
    language,
  })
    .then((response) => {
      jobId = response.jobId;
      taskExecution.jobId = jobId;
      
      // Notify that jobId is ready
      if (jobIdReadyCallback) {
        jobIdReadyCallback(jobId);
      }
      
      // SSE 연결 - 실제 작업 로그만 스트리밍
      eventSource = subscribeToLogs(jobId, (log) => {
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
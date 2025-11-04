import { executeTask, subscribeToLogs } from '@/lib/api';
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
  kill: (signal?: string) => boolean;
  on: (event: 'exit', listener: (code: number | null, signal: string | null) => void) => TaskExecution;
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
  
  const taskExecution: TaskExecution = {
    taskId: '',
    eventSource: null as unknown as EventSource,
    kill: (_signal?: string) => {
      if (eventSource) {
        eventSource.close();
        
        if (exitListener) {
          exitListener(0, null);
        }
      }
      return true;
    },
    on: (event: 'exit', listener: (code: number | null, signal: string | null) => void) => {
      if (event === 'exit') {
        exitListener = listener;
      }
      return taskExecution;
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
      
      // SSE 연결 - 실제 작업 로그만 스트리밍
      eventSource = subscribeToLogs(taskId, (log) => {
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
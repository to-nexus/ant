import { executeJob, stopJob } from '@/infrastructure/http/api';
import { useStore } from '@/domain/store';

export interface ExecuteCodeJobOptions {
  projectId?: string;
  featureName?: string;  // Which feature to execute for
  task?: 'design' | 'code' | 'learn' | 'review' | 'plan' | 'doc';  // Note: 'task' here means agent's work type
  agent?: 'architect' | 'reviewer' | 'planner' | 'doc';
  mode?: 'generate' | 'refactor' | 'explain';
  language?: string;
  cwd?: string;
  overrideDirective?: string;  // ✅ Chat input as directive
  chatSource?: boolean;        // ✅ Flag for Chat SSE
}

export interface JobExecution {
  jobId: string;
  kill: (signal?: string) => Promise<boolean>;
  on: (event: 'exit', listener: (code: number | null, signal: string | null) => void) => JobExecution;
  onJobIdReady: (callback: (jobId: string) => void) => void;
}

export function executeCodeJob(options: ExecuteCodeJobOptions = {}): JobExecution {
  const { 
    projectId = '', 
    featureName = 'skeleton',  // Default to skeleton
    task = 'code',
    agent = 'architect',
    mode = 'generate',
    language = 'en',
    overrideDirective,  // ✅ Chat input as directive
    chatSource          // ✅ Flag for Chat SSE
  } = options;
  
  const store = useStore.getState();
  
  let jobId = '';
  let exitListener: ((code: number | null, signal: string | null) => void) | null = null;
  let jobIdReadyCallback: ((jobId: string) => void) | null = null;
  
  const jobExecution: JobExecution = {
    jobId: '',
    kill: async (_signal?: string) => {
      try {
        // Stop the job on the server
        if (jobId) {
          // ✅ Get actual projectId/featureName/jobType from store (critical for cleanup!)
          const currentState = useStore.getState();
          const actualProjectId = currentState.selectedProject || projectId;
          const actualFeatureName = currentState.selectedFeature || featureName;
          const actualJobType = (currentState.selectedWorkType as 'design' | 'code' | 'learn') || 'code';
          
          await stopJob(jobId, actualProjectId || undefined, actualFeatureName || undefined, actualJobType);
          
          // Notify exit listener (though no longer used since Kanban SSE detects completion)
          if (exitListener) {
            exitListener(0, 'SIGTERM');
          }
        }
      } catch (error) {
        console.error('Error stopping job on server:', error);
      }
      return true;
    },
    on: (event: 'exit', listener: (code: number | null, signal: string | null) => void) => {
      if (event === 'exit') {
        exitListener = listener;
      }
      return jobExecution;
    },
    // Add method to set callback for when jobId is ready
    onJobIdReady: (callback: (jobId: string) => void) => {
      jobIdReadyCallback = callback;
      if (jobId) {
        // If jobId is already available, call immediately
        callback(jobId);
      }
    }
  };
  
  console.log('[cli.ts] executeCodeJob called with:', { projectId, featureName, task, agent, mode, language, overrideDirective: overrideDirective ? '(provided)' : undefined, chatSource });
  
  executeJob({
    projectId,
    featureName,
    task,
    agent,
    mode,
    language,
    overrideDirective,  // ✅ Pass to API
    chatSource           // ✅ Pass to API
  })
    .then((response) => {
      console.log('[cli.ts] executeJob response:', response);
      
      // ✅ Check for prerequisites validation failure
      if (response.error && response.missingMaterials) {
        console.error('[cli.ts] Prerequisites validation failed:', response.error);
        
        // Format error message for display
        const materialsList = response.missingMaterials
          .map((m: any) => `  • ${m.name}: ${m.description}`)
          .join('\n');
        
        const errorMessage = `Cannot start ${task} job. The following required materials are missing:\n\n${materialsList}\n\nAll of these materials must be provided before starting the job.`;
        
        // Show error to user
        alert(errorMessage);
        
        // Notify exit listener
        if (exitListener) {
          exitListener(1, null);
        }
        
        // Reset running state
        store.setRunning(false);
        return;
      }
      
      jobId = response.jobId;
      jobExecution.jobId = jobId;
      
      // Notify that jobId is ready
      if (jobIdReadyCallback) {
        console.log('[cli.ts] Calling jobIdReadyCallback with jobId:', jobId);
        jobIdReadyCallback(jobId);
      } else {
        console.warn('[cli.ts] jobIdReadyCallback is not set!');
      }
      
      // ✅ No logs SSE needed - job completion is detected by:
      // 1. Kanban SSE (activeJobId becomes undefined)
      // 2. Workflow SSE (isCompleted: true)
      // Exit listener will be called when Kanban detects completion
      console.log('[cli.ts] Job started, completion will be detected by Kanban SSE');
    })
    .catch((error) => {
      console.error('[cli.ts] Failed to start job:', error);
      
      if (exitListener) {
        exitListener(1, null);
      }
    });
  
  return jobExecution;
}
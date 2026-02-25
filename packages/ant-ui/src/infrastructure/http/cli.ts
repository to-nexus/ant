import { executeJob, stopJob } from '@/infrastructure/http/api';
import { useStore } from '@/domain/store';

export interface ExecuteCodeJobOptions {
  projectId?: string;
  featureName?: string;  // Which feature to execute for
  jobType?: string;      // ✅ Type of job to execute (design, code, learn, planning, etc.)
  agent?: string;        // ✅ Agent (architect, planner, etc.)
  mode?: 'generate' | 'refactor' | 'explain';
  language?: string;
  cwd?: string;
  overrideDirective?: string;  // ✅ Chat input as directive
  chatSource?: boolean;        // ✅ Flag for Chat SSE
  skipTriage?: boolean;        // ✅ Skip triage node (after proceed choice)
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
    featureName,
    jobType,
    agent,
    mode = 'generate',
    language = 'en',
    overrideDirective,  // ✅ Chat input as directive
    chatSource,         // ✅ Flag for Chat SSE
    skipTriage          // ✅ Skip triage (after proceed choice)
  } = options;
  
  // ✅ Feature name is required
  if (!featureName) {
    throw new Error('Feature name is required for job execution');
  }
  
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
          const actualJobType = currentState.selectedJobType;
          
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
  
  console.log('[cli.ts] executeCodeJob called with:', { projectId, featureName, jobType, agent, mode, language, overrideDirective: overrideDirective ? '(provided)' : undefined, chatSource });
  
  executeJob({
    projectId,
    featureName,
    jobType,
    agent,
    mode,
    language,
    overrideDirective,  // ✅ Pass to API
    chatSource,          // ✅ Pass to API
    skipTriage           // ✅ Pass to API
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
        
        const errorMessage = `Cannot start ${jobType} job. The following required materials are missing:\n\n${materialsList}\n\nAll of these materials must be provided before starting the job.`;
        // ✅ Surface this in the chat stream instead of window.alert().
        try {
          store.addChatMessage({
            id: `msg-prereq-${Date.now()}`,
            role: 'assistant',
            contents: [{ type: 'text', content: `❌ ${errorMessage}` }],
            timestamp: new Date().toISOString()
          });
        } catch (e) {
          console.warn('[cli.ts] Failed to add chat message for prerequisites error:', e);
        }
        
        // Notify exit listener
        if (exitListener) {
          exitListener(1, null);
        }
        
        // Reset running state
        store.setRunning(false);
        store.setLastJobFailed(true);
        return;
      }

      // 409 Conflict: recover state by syncing with the already-running job
      if (response.existingJobId) {
        console.log('[cli.ts] Job already running, recovering state:', response.existingJobId);
        try {
          store.addChatMessage({
            id: `msg-conflict-${Date.now()}`,
            role: 'assistant',
            contents: [{ type: 'text', content: `이미 진행 중인 작업이 있습니다. (Job ID: ${response.existingJobId})` }],
            timestamp: new Date().toISOString()
          });
        } catch (e) {
          console.warn('[cli.ts] Failed to add chat message for conflict:', e);
        }
        store.setRunning(true, response.existingJobId);
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
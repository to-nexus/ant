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
  actionMetadata?: import('@ant/shared').ActionMetadata;  // ✅ Structured context from Actions panel
  /**
   * Pre-allocated turnId from `/chat/user-message`. Forwarded to the
   * worker so the durable user_turn line reuses the same id as the
   * optimistic SSE broadcast (chat SSOT §6).
   */
  seedTurnId?: string;
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
    overrideDirective,
    chatSource,
    skipTriage,
    actionMetadata,
    seedTurnId,
  } = options;

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
        if (jobId) {
          const currentState = useStore.getState();
          const actualProjectId = currentState.selectedProject || projectId;
          const actualFeatureName = currentState.selectedFeature || featureName;
          const actualJobType = currentState.selectedJobType;

          await stopJob(jobId, actualProjectId || undefined, actualFeatureName || undefined, actualJobType);

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
    onJobIdReady: (callback: (jobId: string) => void) => {
      jobIdReadyCallback = callback;
      if (jobId) {
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
    overrideDirective,
    chatSource,
    skipTriage,
    actionMetadata,
    seedTurnId,
  })
    .then((response) => {
      console.log('[cli.ts] executeJob response:', response);

      // Phase 9 chat-SSOT — prereq / conflict / start-error messages
      // now flow through the chat stream as `assistant_message` lines
      // emitted by the BE `/execute` route via
      // `chatService.appendAssistantMessage`. The FE no longer mints
      // optimistic chat bubbles here; SSE delivers them.

      if (response.error && response.missingMaterials) {
        console.error('[cli.ts] Prerequisites validation failed:', response.error);
        if (exitListener) exitListener(1, null);
        store.setRunning(false);
        store.setLastJobFailed(true);
        return;
      }

      if (response.existingJobId) {
        if (response.isInterrupted) {
          console.log('[cli.ts] Interrupted job blocking new start:', response.existingJobId);
          store.setRunning(false);
        } else {
          console.log('[cli.ts] Job already running, recovering state:', response.existingJobId);
          store.setRunning(true, response.existingJobId);
        }
        return;
      }

      jobId = response.jobId;
      jobExecution.jobId = jobId;

      if (jobIdReadyCallback) {
        console.log('[cli.ts] Calling jobIdReadyCallback with jobId:', jobId);
        jobIdReadyCallback(jobId);
      } else {
        console.warn('[cli.ts] jobIdReadyCallback is not set!');
      }

      console.log('[cli.ts] Job started, completion will be detected by Kanban SSE');
    })
    .catch((error) => {
      console.error('[cli.ts] Failed to start job:', error);
      // Job-start failures are surfaced through the BE chat stream as
      // assistant_message lines (job.routes /execute emitConflictAssistantMessage).
      store.setRunning(false);
      store.setLastJobFailed(true);
      if (exitListener) {
        exitListener(1, null);
      }
    });

  return jobExecution;
}

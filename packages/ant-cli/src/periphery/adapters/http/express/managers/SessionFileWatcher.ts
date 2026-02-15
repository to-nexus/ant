import { UserContext } from '../../../../../core/types/user';
import { JobStateTracker } from '../managers/JobStateTracker';
import { ServerDependencies } from '../types';

/**
 * SessionFileWatcher
 * 
 * Manages session file watching for real-time Kanban updates.
 * Coordinates with SessionService to watch for file changes.
 */
export class SessionFileWatcher {
  constructor(
    private readonly stateTracker: JobStateTracker,
    private readonly deps: ServerDependencies
  ) {}

  /**
   * Watch session file for changes
   */
  watchSessionFile(
    jobId: string, 
    projectId: string, 
    featureName: string, 
    task: string
  ): void {
    // SSE client checker removed - SSE is now handled by Realtime Server
    // Always return true to keep watching (Realtime Server manages actual client connections)
    const sseClientChecker = () => true;
    
    // Map task to job type
    const job = (task === 'design' || task === 'code' || task === 'learn') ? task : 'code';
    const mapping = this.stateTracker.getJobMapping(jobId);
    const userContext: UserContext = mapping?.userContext || {
      userId: 'local',
      organizationId: 'local',
    };
    
    this.deps.sessionService.watchSessionFile(
      projectId, 
      featureName, 
      job, 
      userContext, 
      sseClientChecker
    );
  }
}

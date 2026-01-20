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
    const sseClientChecker = () => {
      const mapping = this.stateTracker.getJobMapping(jobId);
      return this.deps.sseService.getClientCount(
        projectId, 
        featureName, 
        mapping?.userContext
      ) > 0;
    };
    
    // Map task to job type
    const job = (task === 'design' || task === 'code' || task === 'learn') ? task : 'code';
    const mapping = this.stateTracker.getJobMapping(jobId);
    const userContext: UserContext = mapping?.userContext || {
      userId: 'local',
      organizationId: 'local',
      workspacePath: ''
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

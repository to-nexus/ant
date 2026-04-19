/**
 * Resolve Node — Shared Utilities
 *
 * Common helper functions used by multiple resolve strategies.
 * Extracted to avoid duplication between code and design resolve.
 */

/**
 * Validate workspace and feature directories exist.
 * Returns the resolved absolute featurePath.
 * Shared by code and design resolve strategies.
 */
export async function validateWorkspaceAndFeature(params: {
  context: { userId?: string; organizationId?: string; project: string; featureFolder: string };
  workspaceResolver: {
    getProjectPath(userContext: any, project: string): string;
    getFeaturePath(userContext: any, project: string, featureFolder: string): string;
  };
}): Promise<string> {
  const { context, workspaceResolver } = params;
  const fs = await import('fs');

  const userContext = {
    userId: context.userId || 'local',
    organizationId: context.organizationId || 'local',
  };

  const workspacePath = workspaceResolver.getProjectPath(userContext, context.project);
  if (!fs.existsSync(workspacePath)) {
    throw new Error(
      `Workspace not found: ${workspacePath}\n\n` +
      `Please create workspace first:\n` +
      `  npm run init:workspace ${context.project}\n\n` +
      `Then prepare your inputs in:\n` +
      `  ${workspacePath}/${context.featureFolder}/inputs/`,
    );
  }

  const featurePath = workspaceResolver.getFeaturePath(userContext, context.project, context.featureFolder);
  if (!fs.existsSync(featurePath)) {
    throw new Error(
      `Feature directory not found: ${featurePath}\n\n` +
      `Please create feature first:\n` +
      `  npm run init:feature ${context.project} ${context.featureFolder}\n\n` +
      `Then prepare your inputs in:\n` +
      `  ${featurePath}/inputs/`,
    );
  }

  return featurePath;
}

/**
 * Initialize jobTiming for a new job and optionally save to session.
 * Shared between code and design resolve strategies.
 */
export async function initJobTiming(params: {
  httpJobId: string;
  session?: { updateArtifacts: (...args: any[]) => Promise<void> };
  kanbanUpdate?: { setJobTiming?: (timing: any) => void };
  project?: string;
  featureFolder?: string;
  jobType: string;
  extraSessionState?: Record<string, any>;
}): Promise<{ jobId: string; jobTiming: any }> {
  const { JobTimingManager } = await import('../../timing/JobTimingManager.js');
  const { jobId, jobTiming } = JobTimingManager.initializeNewJob(params.httpJobId);

  if (params.kanbanUpdate?.setJobTiming) {
    params.kanbanUpdate.setJobTiming(jobTiming);
  }

  if (params.session && params.project && params.featureFolder) {
    try {
      await params.session.updateArtifacts(
        params.project,
        params.featureFolder,
        params.jobType,
        {
          state: {
            jobId,
            jobTiming,
            taskQueue: [],
            completedTasks: [],
            completedTasksDetails: [],
            ...params.extraSessionState,
          },
        },
      );
    } catch {
      // Non-critical: session save may fail
    }
  }

  return { jobId, jobTiming };
}

/**
 * Resolve Node — Shared Utilities
 *
 * Common helper functions used by multiple resolve strategies.
 * Extracted to avoid duplication between code and design resolve.
 */

import type { ConversationEntry } from '../../../../core/types/session.js';
import { BOUNDARY } from '@ant/shared';

/**
 * Compress uncompressed heavyweight entries in jobConversation via LLM summarization.
 * Shared between code and design resolve strategies (Trigger 2: heavyweight compression).
 */
export async function compressHeavyweightEntries(
  entries: ConversationEntry[],
  llm: { invoke: (messages: any[], options?: any) => Promise<string> },
  promptPort: { render: (template: string, data: any) => Promise<string> },
): Promise<{ entries: ConversationEntry[]; changed: boolean }> {
  let changed = false;
  const result: ConversationEntry[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (
      entry.role === 'assistant' &&
      entry.metadata?.boundary === BOUNDARY.HEAVYWEIGHT &&
      !entry.metadata?.chapterSummary
    ) {
      const userEntry = result[result.length - 1];
      const jobData = [
        `Directive: ${userEntry?.content || ''}`,
        `Result: ${entry.content}`,
      ].join('\n');

      try {
        const systemPrompt = await promptPort.render('common/compaction/job-summary', { jobData });
        const summaryContent = await llm.invoke(
          [{ role: 'user', content: 'Summarize this job.' }],
          { system: systemPrompt, maxTokens: 2048 },
        );
        result.push({
          ...entry,
          content: summaryContent,
          metadata: { ...entry.metadata, chapterSummary: 'Heavyweight job summary' },
        });
        changed = true;
      } catch (err) {
        console.warn(`⚠️  [Resolve] Heavyweight compression failed, keeping raw entry:`, err);
        result.push(entry);
      }
    } else {
      result.push(entry);
    }
  }
  return { entries: changed ? result : entries, changed };
}

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
  const { JobTimingManager } = await import('../../graph/timing/JobTimingManager.js');
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

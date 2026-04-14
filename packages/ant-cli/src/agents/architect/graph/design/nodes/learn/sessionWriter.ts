import { DesignGraphState } from '../../state';
import { SessionRun, ConversationEntry } from '../../../../../../core/types';
import { BOUNDARY, DESIGN_DIR, DESIGN_SUBDIR } from '@ant/shared';
import { ArtifactPoolView } from '../../../../../../core/prompt/builder/ArtifactPipeline';
import { buildDesignJobRecord } from './jobRecord';

/**
 * Save session run with all metadata
 */
export async function saveSessionRun(state: DesignGraphState): Promise<void> {
  if (!state.deps?.session) return;
  
  const workerId = state.workerId;
  if (workerId !== undefined && workerId !== null) return;
  
  const { extractDesignDecisions } = await import('./lessonExtractor');
  const decisions = extractDesignDecisions(state).split('\n').filter(d => d.trim());
  
  const inputSummary = (state.directive || '').length > 200 
    ? (state.directive || '').substring(0, 197) + '...' 
    : (state.directive || '');
  
  const planLines = state.planText.split('\n');
  const planSummary = planLines.slice(0, 3).join('\n') + (planLines.length > 3 ? '...' : '');
  
  const run: SessionRun = {
    runId: 0,
    job: 'design',
    timestamp: new Date().toISOString(),
    input: (() => {
      const pool = new ArtifactPoolView(state.artifacts || []);
      return {
        type: 'file' as const,
        source: pool.hasSources()
          ? pool.sources.map(a => a.path).join(', ')
          : 'inputs/sources/prd.md',
        summary: inputSummary,
        size: (state.directive || '').length,
      };
    })(),
    output: {
      planSummary: planSummary.substring(0, 300),
      decisionCount: decisions.length,
      fileCount: state.files?.length || 1
    }
  };
  
  await state.deps.session.addRun(
    state.context.project,
    state.context.featureFolder || 'default',
    'design',
    run
  );
  
  const existingSession = await state.deps.session.load(
    state.context.project,
    state.context.featureFolder || 'default',
    'design'
  );

  const completedJobTiming = state.jobTiming ? {
    ...state.jobTiming,
    completedAt: new Date().toISOString()
  } : undefined;

  let directivesArray: string[] = [];
  if (state.directive) {
    if (state.directive.includes('\n\n---\n\n')) {
      directivesArray = state.directive.split('\n\n---\n\n').filter(d => d.trim());
    } else {
      directivesArray = [state.directive];
    }
  }

  // Inter-Job Context Bridge: append raw job record
  const isLastTask = !state.taskQueue || state.taskQueue.isEmpty();
  let updatedJobConversation = existingSession.state?.jobConversation;
  if (isLastTask) {
    const { user: jobUser, assistant: jobAssistant } = buildDesignJobRecord(state);
    const existingJobConv: ConversationEntry[] = existingSession.state?.jobConversation || [];
    updatedJobConversation = [...existingJobConv, jobUser, jobAssistant];
    console.log(`📋 [Design Learn] Inter-Job Context: appended raw record (${updatedJobConversation.length} total entries, boundary=${state.boundary || BOUNDARY.LIGHTWEIGHT})`);
  }

  await state.deps.session.updateArtifacts(
    state.context.project,
    state.context.featureFolder || 'default',
    'design',
    {
      keyDecisions: decisions.slice(0, 5),
      state: {
        taskQueue: state.taskQueue?.getAll() || [],
        currentTask: state.currentTask,
        completedTasks: state.completedTasks || [],
        completedTasksDetails: state.completedTasksDetails || [],
        interruption: existingSession.state?.interruption,
        jobId: state.jobId,
        jobTiming: completedJobTiming,
        tokenUsage: state.tokenUsage,
        estimatingTokenUsage: state._estimatingTokenUsage,
        directives: directivesArray,
        overrideDirective: state.overrideDirective,
        chatSource: state.chatSource,
        resolvedAction: state.resolvedAction,
        jobConversation: updatedJobConversation,
      }
    }
  );
}

import { DesignGraphState } from '../../state';
import { SessionRun } from '../../../../../../core/types';
import { getCanonicalPlanPath } from '@ant/shared';
import { ArtifactPoolView } from '../../../../../../core/prompt/builder/ArtifactPipeline';
import { saveLearnCheckpoint } from '../../session/checkpoint';

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
      // Domain-aware fallback: a workspace with no concrete sources in
      // the pool still has a notional plan-document path. Service
      // resolves to prd.md, game to gdd.md.
      const fallbackPath = getCanonicalPlanPath(state.resolvedAction?.domain);
      return {
        type: 'file' as const,
        source: pool.hasSources()
          ? pool.sources.map(a => a.path).join(', ')
          : fallbackPath,
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

  await saveLearnCheckpoint(state, {
    decisions,
    directivesArray,
    completedJobTiming,
    existingInterruption: existingSession.state?.interruption,
  });
}

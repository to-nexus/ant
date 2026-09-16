import type { ActivePipelineInfo } from '@ant/shared';

export { selectPipelineDirty, type PipelineDirtyReport } from '../slices/pipelineSlice';

/**
 * Pipeline selectors — the chat surface's activation lock reads live here so
 * ChatInput / useChatPolicy / the banner share one derivation.
 */

interface PipelineSelectorState {
  selectedProject: string | null | undefined;
  activePipelineByProject: Record<string, ActivePipelineInfo | null>;
  pipelineApprovals: Array<{ gateId: string; pipelineId: string }>;
}

/** Active pipeline bound to a given project, or null. */
export const selectActivationByProject = (
  state: PipelineSelectorState,
  projectId: string | null | undefined,
): ActivePipelineInfo | null => {
  if (!projectId) return null;
  return state.activePipelineByProject?.[projectId] ?? null;
};

/** Active pipeline for the currently selected project (chat lock signal). */
export const selectActivePipelineForSelectedProject = (
  state: PipelineSelectorState,
): ActivePipelineInfo | null => selectActivationByProject(state, state.selectedProject);

/** Account-wide pending approval count (navbar + tab-chip badges) — the inbox rows are the ONE count owner. */
export const selectPipelineApprovalCount = (state: PipelineSelectorState): number =>
  state.pipelineApprovals?.length ?? 0;

/** Pending rows of ONE pipeline (rail badge) — inbox parity: approver rows on org pipelines are "waiting on you" too. */
export const selectPipelineApprovalCountFor = (state: PipelineSelectorState, pipelineId: string): number =>
  state.pipelineApprovals?.filter((a) => a.pipelineId === pipelineId).length ?? 0;

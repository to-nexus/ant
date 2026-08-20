import type { ActivePipelineInfo } from '@ant/shared';

/**
 * Pipeline selectors — the chat surface's activation lock reads live here so
 * ChatInput / useChatPolicy / the banner share one derivation.
 */

interface PipelineSelectorState {
  selectedProject: string | null | undefined;
  activePipelineByProject: Record<string, ActivePipelineInfo | null>;
  pipelineApprovals: Array<{ gateId: string }>;
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

/** Account-wide pending approval count (tab-chip badge). */
export const selectPipelineApprovalCount = (state: PipelineSelectorState): number =>
  state.pipelineApprovals?.length ?? 0;

/**
 * Single accessor for the current job's project id off a graph-state-like
 * object. The graph-state field is `state.context.project` (ProjectContext,
 * `core/types/agent.ts`); `projectName` is a `WorkspaceConfig` field that is
 * never written onto the agent context. Reading the wrong name silently
 * yielded `undefined`, which let the current project (and all its branches)
 * leak into the reference catalog and nulled `ctx.project` for tool handlers.
 * Centralized here so the four former read-sites can never re-drift.
 */

export interface CurrentProjectStateLike {
  context?: { project?: string };
}

export function currentProjectOf(state: CurrentProjectStateLike): string | undefined {
  return state.context?.project;
}

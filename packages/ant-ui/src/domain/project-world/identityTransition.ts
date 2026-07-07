/**
 * identityTransition — the SSOT policy for what UI state resets when the
 * `(project, feature)` identity changes.
 *
 * Two halves make up an identity transition:
 *   - SYNCHRONOUS store reset (this module + `applyIdentityTransition` in
 *     `resetSlice`): clear feature-scoped runtime, close feature/project-scoped
 *     secondary tabs, evict the previous feature's preview/deploy buckets,
 *     drop the transfer pre-selected source.
 *   - ASYNC refetch (`useProjectLifecycle`): reset + refetch git-world and
 *     project-config, reconnect SSE. Left untouched here.
 *
 * `setSelectedProject`, `setSelectedFeature`, and `reset()` all funnel their
 * synchronous clearing through this policy so there is ONE description of
 * "what cleared state looks like" — see docs/internals/ui-async-policy.md
 * §7.5.4 (no parallel ghost surfaces).
 *
 * Kept store-free (only a type-only import) so `resetSlice` can consume it
 * without a `store ↔ project-world` runtime cycle.
 */
import type { StaticMainPanelTab } from '../store/types';

export type IdentityScope = 'project' | 'feature';

/**
 * The store-field patch cleared on an identity transition. Scope-aware so it
 * matches the long-standing per-scope behavior exactly:
 *
 *   - BOTH scopes clear the transient editor/figma/parallel-job fields.
 *   - Only a PROJECT change additionally wipes the conversation / board /
 *     session runtime. On a feature change those are refilled by the SSE
 *     reconnect + session load, so clearing them synchronously would only
 *     flash an empty board.
 */
export function identityResetPatch(scope: IdentityScope): Record<string, unknown> {
  const base: Record<string, unknown> = {
    figmaPopulated: null,
    editorTabs: [],
    activeEditorTabId: null,
    activeJobs: {},
    pendingAutoSelect: false,
  };
  if (scope === 'feature') return base;
  return {
    ...base,
    session: undefined,
    chatEvents: [],
    streamingBuffers: {},
    lastChatSnapshotTs: undefined,
    kanban: {
      jobId: undefined,
      todo: [],
      inProgress: [],
      completed: [],
      isEstimating: false,
      dataSource: 'session' as const,
    },
    isRunning: false,
    currentJobId: undefined,
  };
}

/**
 * Secondary main-panel tabs that close on any identity change. `fileEdit`
 * (feature's files) and `transfer` (carries a feature-scoped source) are
 * meaningless once the feature changes.
 */
const FEATURE_SCOPED_TABS: StaticMainPanelTab[] = ['fileEdit', 'transfer'];

/**
 * Which secondary tabs to close for a given transition.
 *
 * `previewConfig` is feature-scoped but its bucket read is keyed on identity
 * and `usePreviewSync` re-fetches on feature change — so on a FEATURE change
 * it stays open and reloads. Only a PROJECT change (feature → undefined)
 * closes it, since a preview tab with no feature has no context.
 */
export function tabsToCloseOnTransition(scope: IdentityScope): StaticMainPanelTab[] {
  return scope === 'project'
    ? [...FEATURE_SCOPED_TABS, 'previewConfig']
    : [...FEATURE_SCOPED_TABS];
}

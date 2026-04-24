/**
 * git-world SSE handler.
 *
 * The **single** entry point from the unified `gitState` SSE event into the
 * git-world slice. Registered once per app mount, returns a cleanup fn.
 *
 * Branch on `cause` (discriminated union) rather than sniffing fields:
 * - `workingTreeChange`  → lightweight hint; debounced snapshot refetch.
 * - `operationComplete`  → authoritative snapshot + FSM transition.
 * - `reconnectRefill`    → authoritative snapshot (on SSE open).
 *
 * Ownership: this module may call `_applyGitStateEvent` and
 * `_refreshWorkingTreeDebounced` on the slice. No other consumer is
 * allowed to touch these (enforced by ESLint `no-restricted-imports`
 * on git-world/infrastructure and the underscore-prefix convention).
 */

import type { GitStateEventData } from '@ant/shared';
import { useStore } from '../store';
import { sseManager } from '../../infrastructure/sse/SSEManager';

export function registerGitStateHandler(): () => void {
  const handlerId = sseManager.registerHandlerWithId('gitState', (data: GitStateEventData) => {
    const state = useStore.getState() as any;

    // Cheap guard — events for other projects/features simply ignore.
    if (data.project !== state.selectedProject) return;
    if ((data.feature ?? undefined) !== (state.selectedFeature ?? undefined)) return;

    if (data.cause === 'workingTreeChange') {
      state._refreshWorkingTreeDebounced?.(data.project, data.feature ?? undefined);
      return;
    }

    // operationComplete / reconnectRefill both carry the full snapshot+pat.
    state._applyGitStateEvent?.(data);
  });

  return () => {
    sseManager.unregisterHandlerById(handlerId);
  };
}

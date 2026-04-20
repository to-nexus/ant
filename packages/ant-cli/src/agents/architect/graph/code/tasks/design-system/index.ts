/**
 * tasks/design-system/index.ts — design-system task bundle.
 *
 * Design-system tasks generate tokens / assets / spec artefacts in a
 * strict priority-ordered pipeline (100 → 200 → 300). Ordering is
 * enforced by priority-gated barriers in the orchestrator, not by
 * `task.type === 'design-system'` checks, so no `preXxxBarrier` flags
 * are set here.
 *
 * Hooks published:
 *   - conversations.convKey     — per-task conversation scope
 */

import type { TaskHooks } from '../_shared/types';

import { convKey } from './hooks/conversations';

export const hooks: TaskHooks = {
  conversations: { convKey },
};

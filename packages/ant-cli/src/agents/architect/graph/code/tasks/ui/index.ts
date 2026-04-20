/**
 * tasks/ui/index.ts — ui task bundle.
 *
 * UI tasks render the view layer from `uiSections` + design tokens.
 * At T5b.3 the bundle exposes the barrier + conv-key hooks; the
 * UI-specific prompt variant (`uiSections` scope injection) is
 * deferred to T6 along with the plan-node decomposition.
 *
 * Hooks published:
 *   - scheduling.preUiBarrier   — block ui work while feature/setup runs
 *   - conversations.convKey     — per-task conversation scope
 */

import type { TaskHooks } from '../_shared/types';

import { preUiBarrier } from './hooks/scheduling';
import { convKey } from './hooks/conversations';

export const hooks: TaskHooks = {
  scheduling: { preUiBarrier },
  conversations: { convKey },
};

export { isUiTask } from './model/is';

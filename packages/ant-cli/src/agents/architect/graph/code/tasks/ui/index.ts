/**
 * tasks/ui/index.ts — ui task bundle.
 *
 * UI tasks render the view layer from `uiSections` + design tokens.
 *
 * Hooks published:
 *   - scheduling.preUiBarrier   — block ui work while `blocksUi`
 *                                 producers (setup / feature) run.
 *   - conversations.convKey     — per-task conversation scope (pre-wiring;
 *                                 phase layer still shares
 *                                 `CONV_KEYS.NODE_EXECUTE`).
 *
 * Intentionally absent:
 *   - plan.buildPrompt / extraTemplateVars — UI flows through the
 *     shared `jobs/code/nodes/plan/base` template and the generic
 *     artifact-resolution pipeline. `uiSections` scoping is applied
 *     upstream during decompose (drives `task.include` + `artifactPolicy`),
 *     so no ui-specific plan variant template or template-var override
 *     is required. There is no `plan/variants/ui/` template and no
 *     planGeneration.ts branch to port.
 *   - scheduling producer flags (`blocksUi / blocksTestgen / blocksDoc /
 *     blocksIntegration`) — UI is a barrier sink only; it does not
 *     activate barriers for other task types.
 *
 * Phase-layer `task.type === 'ui'` residuals (`nodes/decompose/
 * responseParser.ts` design-context guard, `nodes/execute/
 * toolDefinitions.ts` frontend detection) are pre-existing R1 misses
 * scheduled for follow-up T6b slices. The pre-T6b-ι
 * `nodes/execute/buildMessages.ts` expected-type OR chain is resolved
 * (the warning guard now checks hook presence, not task-type
 * literals).
 */

import type { TaskHooks } from '../_shared/types';

import { preUiBarrier } from './hooks/scheduling';
import { convKey } from './hooks/conversations';

export const hooks: TaskHooks = {
  scheduling: { preUiBarrier },
  conversations: { convKey },
};

export { isUiTask } from './model/is';

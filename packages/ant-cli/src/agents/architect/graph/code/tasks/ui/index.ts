/**
 * tasks/ui/index.ts — ui task bundle.
 *
 * UI tasks render the view layer from `uiSections` + design tokens.
 *
 * Hooks published:
 *   - scheduling.preUiBarrier   — block ui work while `blocksUi`
 *                                 producers (setup / feature) run.
 *   - scheduling.blocksTestgen  — producer: test-code tasks wait for ui
 *                                 work to finish so generated tests
 *                                 target fully-built views (alongside
 *                                 setup / feature). doc is gated
 *                                 transitively (doc waits on test-code).
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
 *   - scheduling producer flags `blocksUi / blocksDoc / blocksIntegration`
 *     — ui gates ONLY testgen (no self-block on ui; doc reaches ui
 *     transitively via test-code; integration is a feature-band concern).
 *
 * Phase-layer `task.type === 'ui'` residuals were resolved in T6b-κ:
 *   - `nodes/decompose/responseParser.ts deriveArtifactPolicy` — the
 *     ui||design-system design-context guard now dispatches through
 *     `isUiTask` / `isDesignSystemTask` instead of literal comparison.
 *   - `nodes/execute/tools.ts isFrontendTask` — the OR chain
 *     now calls `isUiTask` / `isFeatureTask` / `isDesignSystemTask`.
 * The pre-T6b-ι `nodes/execute/buildMessages.ts` expected-type OR
 * chain is resolved separately (the warning guard checks hook
 * presence, not task-type literals).
 */

import { preUiBarrier, blocksTestgen } from './hooks/scheduling';
import { convKey } from './hooks/conversations';
import { extraTemplateVars as planExtraTemplateVars } from './hooks/plan';
import { composeBundle } from '../_shared/verify';

// Wired through `composeBundle({...})` so Tier 2 self-verify UI tasks
// (decompose-time `selfVerifyOnDone:true`) automatically pick up the
// `_shared/verify/` hook surface once they transition into verify-mode.
// Tier 3+ UI tasks pass through unchanged.
//
// `apply.plan.extraTemplateVars` publishes the workspace-dep-snapshot
// template variables so UI tasks see the workspace's existing
// `react` / `radix-ui` / `@emotion/*` pins before pulling in a different
// version. The policy guard in `manifestPinPolicy.ts` enforces the
// constraint at write/install time; this hook is the read-only
// visibility surface.
export const hooks = composeBundle({
  apply: {
    plan: { extraTemplateVars: planExtraTemplateVars },
  },
  taskTypeSpecific: {
    scheduling: { preUiBarrier, blocksTestgen },
    conversations: { convKey },
  },
});

export { isUiTask } from './model/is';

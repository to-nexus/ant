/**
 * tasks/setup/index.ts — setup task bundle.
 *
 * Setup tasks install dependencies, scaffold configs, and otherwise
 * bring the workspace into a state where feature work can proceed.
 *
 * Hooks published:
 *   - scheduling.blocksUi / blocksTestgen / blocksDoc — setup work
 *     activates the UI / testgen / doc barriers for downstream tasks
 *     (T6b-ε; replaces `task.type === 'setup'` predicates in
 *     `parallel/TaskOrchestrator.ts`).
 *   - decompose.isExclusive      — setup is always exclusive
 *   - conversations.convKey      — per-task conversation scope
 *   - plan.extraTemplateVars     — injects `setupConstraints` into the
 *     generic plan base render (T6b-β; port of planGeneration.ts L204).
 *     Setup does not override the full `buildPrompt` because it still
 *     flows through the generic artifact-resolution / RAC pipeline.
 */

import { blocksUi, blocksTestgen, blocksDoc } from './hooks/scheduling';
import { isExclusive } from './hooks/decompose';
import { convKey } from './hooks/conversations';
import { extraTemplateVars as planExtraTemplateVars } from './hooks/plan';
import { executeHook } from './hooks/execute';
import { composeBundle } from '../_shared/verify';

// Wired through `composeBundle({...})` so Tier 2 self-verify setup tasks
// (decompose-time `selfVerifyOnDone:true`) automatically pick up the
// `_shared/verify/` hook surface once they transition into verify-mode.
// Tier 3+ setup tasks pass through unchanged with their apply-phase
// extraTemplateVars + executeHook.
export const hooks = composeBundle({
  apply: {
    plan: { extraTemplateVars: planExtraTemplateVars },
    execute: executeHook,
  },
  taskTypeSpecific: {
    scheduling: { blocksUi, blocksTestgen, blocksDoc },
    decompose: { isExclusive },
    conversations: { convKey },
  },
});

export { isSetupTask } from './model/is';

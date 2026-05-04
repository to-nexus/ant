/**
 * tasks/setup/index.ts — setup task bundle.
 *
 * Setup tasks install dependencies, scaffold configs, and otherwise
 * bring the workspace into a state where feature work can proceed.
 *
 * Hooks published:
 *   - scheduling.blocksUi / blocksTestgen / blocksDoc — setup work
 *     activates the UI / testgen / doc barriers for downstream tasks.
 *   - scheduling.classify      — per-task scheduling role. Publishes
 *     `isTokens=true` for priority 100–199 so setup tasks slip
 *     through the foundation gate (`hasPreFeatureWork` blocks only
 *     `!isFoundation ∧ !isTokens` — i.e., the feature band 300+).
 *     Without this, monorepo package-level setup tasks deadlock
 *     while design-system tasks sit queued (see
 *     `hooks/scheduling.ts` for the regression rationale).
 *   - decompose.isExclusive      — setup is always exclusive
 *   - conversations.convKey      — per-task conversation scope
 *   - plan.extraTemplateVars     — injects `setupConstraints` into the
 *     generic plan base render.
 */

import {
  blocksUi,
  blocksTestgen,
  blocksDoc,
  classify as schedulingClassify,
} from './hooks/scheduling';
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
    scheduling: { blocksUi, blocksTestgen, blocksDoc, classify: schedulingClassify },
    decompose: { isExclusive },
    conversations: { convKey },
  },
});

export { isSetupTask } from './model/is';

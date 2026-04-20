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

import type { TaskHooks } from '../_shared/types';

import { blocksUi, blocksTestgen, blocksDoc } from './hooks/scheduling';
import { isExclusive } from './hooks/decompose';
import { convKey } from './hooks/conversations';
import { extraTemplateVars as planExtraTemplateVars } from './hooks/plan';
import { executeHook } from './hooks/execute';

export const hooks: TaskHooks = {
  scheduling: { blocksUi, blocksTestgen, blocksDoc },
  decompose: { isExclusive },
  conversations: { convKey },
  plan: { extraTemplateVars: planExtraTemplateVars },
  execute: executeHook,
};

export { isSetupTask } from './model/is';

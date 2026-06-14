/**
 * Task hook registry — the single dispatch surface for task-type-specific
 * behaviour. Phase nodes look hooks up via either:
 *
 *   hooksIfActive(state)              — when state is in scope
 *   hooksForTaskType(task.type)       — when only a task/ctx is available
 *
 * Both entry points share the same registry so behaviour is consistent
 * whether the caller is a phase node, router, orchestrator, or tool
 * handler. Fake-state casts that fabricate a `currentTask` object solely
 * to re-use `hooksIfActive` are banned; use `hooksForTaskType` in
 * stateless contexts instead.
 *
 * Wiring is static: each `tasks/{type}/index.ts` exports a `hooks`
 * bundle that is imported at module-load time below. There is no runtime
 * mutation API — registering new task types means adding an import and a
 * REGISTRY entry here.
 */
import type { TaskType } from '@ant/shared';
import type { TaskHooks } from './types';
import { hooks as verificationHooks } from '../verification';
import { hooks as errorHooks } from '../error';
import { hooks as setupHooks } from '../setup';
import { hooks as uiHooks } from '../ui';
import { hooks as designSystemHooks } from '../design-system';
import { hooks as testCodeHooks } from '../test-code';
import { hooks as docHooks } from '../doc';
import { hooks as featureHooks } from '../feature';
import { hooks as seamHooks } from '../seam';

const REGISTRY: Record<TaskType, TaskHooks> = {
  verification: verificationHooks,
  error: errorHooks,
  setup: setupHooks,
  ui: uiHooks,
  'design-system': designSystemHooks,
  'test-code': testCodeHooks,
  doc: docHooks,
  feature: featureHooks,
  seam: seamHooks,
  // R1 dispatch flags — explain tasks are response-only (Tier 0); the
  // plan phase is bypassed entirely. Inline here because explain has
  // no `tasks/explain/index.ts` bundle (only `model/is.ts`); creating
  // a bundle for two flags would be over-structured. Replaces the
  // `isExplainTask(task)` predicate in `taskRequiresPlan`.
  explain: { plan: { requiresPlanText: false, usesToolLoop: false } },
};

/** Look up hooks by explicit task type. Returns `undefined` when type is unset. */
export function hooksForTaskType(taskType: TaskType | undefined): TaskHooks | undefined {
  if (!taskType) return undefined;
  return REGISTRY[taskType];
}

/** Look up hooks for the current task recorded on state. */
export function hooksIfActive(
  state: { currentTask?: { type?: TaskType } } | undefined,
): TaskHooks | undefined {
  return hooksForTaskType(state?.currentTask?.type);
}

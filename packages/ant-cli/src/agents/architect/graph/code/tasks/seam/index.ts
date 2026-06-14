/**
 * tasks/seam/index.ts — seam task bundle.
 *
 * Seam tasks own cross-feature reference + affordance CLOSURE for ONE module /
 * package. They are a dedicated TaskType (not a feature band): their essence is
 * closure over the materialized graph (resolve-or-remove), the same family as
 * verification / error, NOT authoring. They run AFTER all authoring
 * (feature + ui) and BEFORE test-code / doc / verification.
 *
 * Prompt wiring (see `core/prompt/builder/templatePaths.ts` `codeExecuteSeam`):
 *   - PLAN  — rides the generic `codePlanDefault` (no `plan` hook here), reusing
 *     the slim-slice / prePlanText / SV-gate / batches machinery. The seam
 *     enumerate-&-partition guidance is supplied by the type-gated
 *     `seam-connectivity-closure` partial in `plan/rules.md`. `requiresPlanText`
 *     defaults true → the parent runs the plan-tool-loop to enumerate the
 *     reference graph and either remediates inline or fans out `batches[]`.
 *   - EXECUTE — dedicated `codeExecuteSeam` variant (resolve-or-remove); the
 *     default execute's authoring directives are the wrong essence for closure.
 *
 * No `composeBundle` — seam never enters verify-mode (`selfVerifyOnDone` is not
 * set on seam tasks; `requiresVerification(seam)` is false), so the verify-mode
 * router wrapping is unnecessary. Wired directly (like the dedicated
 * verification bundle).
 *
 * Scheduling: seam consumes the seam barrier (waits for all authoring) and
 * blocks test-code / doc (they observe the closed graph). See `hooks/scheduling`.
 */

import type { TaskHooks } from '../_shared/types';
import { executeHook } from './hooks/execute';
import { convKey } from './hooks/conversations';
import {
  preSeamBarrier,
  blocksTestgen,
  blocksDoc,
  classify as schedulingClassify,
} from './hooks/scheduling';

export const hooks: TaskHooks = {
  execute: executeHook,
  conversations: { convKey },
  scheduling: {
    preSeamBarrier,
    blocksTestgen,
    blocksDoc,
    classify: schedulingClassify,
  },
};

export { isSeamTask } from './model/is';

/**
 * doc/hooks/scheduling.ts — TaskSchedulingHook
 *
 * CODE-JOB ROLE (doc@800) — consumer barrier only.
 *   Doc tasks describe the code that was written, so they must wait for
 *   feature + setup + test-code work to finish. They publish the
 *   `preDocBarrier` consumer flag so the orchestrator gates them behind
 *   the cross-type `hasPreDocWork` barrier. Who activates `hasPreDocWork`
 *   is a producer-side concern and lives on each upstream bundle's
 *   `scheduling.blocksDoc` flag (currently `setup` + `feature` +
 *   `test-code`).
 *
 * DESIGN-JOB ROLE (doc@100..1000) — priority-band scheduling.
 *   The design job emits EVERY task as `type: 'doc'` (see
 *   `graph/design/nodes/decompose/*Decompose.ts`). Priority bands map
 *   to design-job scheduling roles:
 *       priority 100–199 — tokens (theme / token sources)
 *       priority 200–299 — assets / foundation (icons, shared visuals)
 *       priority 300+    — spec (chapter / system doc bodies)
 *   The `barriers.spec: true` wiring in `graph/design/graph.ts` uses
 *   `hasPreAssetsWork` (blocks 200+) and `hasPreSpecWork` (blocks 300+).
 *   Both barriers now consult `classify(t)` instead of hard-coded
 *   priority windows in the orchestrator.
 *
 *   Code-job doc tasks sit at priority 800 — classify returns
 *   `{ isTokens: false, isFoundation: false }` for them, so this
 *   dual-role implementation is safe: the barriers that would fire on
 *   `isTokens` / `isFoundation` are only enabled in the design job
 *   (`barriers.assets` / `barriers.spec`), and even if a code-job
 *   hypothetical turned them on, the classify output keeps doc@800 out
 *   of the foundation / tokens bands.
 *
 * Intentionally unpublished:
 *   - preUiBarrier / preTestgenBarrier / preIntegrationBarrier — doc is
 *     sequenced strictly after the `blocksDoc` producers; it does not
 *     consume the ui / testgen / integration barriers.
 *   - blocksUi / blocksTestgen / blocksDoc / blocksIntegration — doc is
 *     a barrier sink only (code job). In particular `blocksDoc=undefined`
 *     is a deliberate regression guard: self-activation would make
 *     sibling doc tasks block each other from parallel scheduling.
 */

import type { BaseTask } from '@ant/shared';
import type { SchedulingClassification } from '../../_shared/types';
import { TASK_PRIORITIES } from '../../../state';

export const preDocBarrier = true;

// Design-job token band [100, 199]. The code-job `TASK_PRIORITIES` map
// names 100 (`SETUP_PROJECT`) and 189 (`SETUP_MAX`) for the setup
// concern; the tokens band reaches priority 199 to give the design job
// 90 distinct tokens slots without colliding with the assets band at 200.
const TOKENS_BAND_MIN = 100;
const TOKENS_BAND_MAX = 199;

export function classify(task: Pick<BaseTask, 'priority'>): SchedulingClassification {
  const p = task.priority;
  return {
    isTokens: p >= TOKENS_BAND_MIN && p <= TOKENS_BAND_MAX,
    isFoundation:
      p >= TASK_PRIORITIES.SHARED_FOUNDATION && p <= TASK_PRIORITIES.FOUNDATION_MAX,
  };
}

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

export const preDocBarrier = true;

/**
 * Design-JOB doc priority bands — an axis ORTHOGONAL to the code-job
 * `TASK_PRIORITY` map (NOT that map). The design job emits ALL tasks as
 * `type: 'doc'` and discriminates scheduling by priority band:
 *   tokens 100-199 (theme / token sources) → `isTokens`
 *   assets 200-299 (icons, shared visuals) → `isFoundation`
 *   spec   300+    (chapter / system bodies) → neither
 * This is the single source for these design-job bands; it deliberately does
 * not reference code-job windows (e.g. setup's 189 ceiling) — the two priority
 * systems are independent (see docs/internals/41-task-priority-band-system.md).
 */
const DESIGN_DOC_BANDS = {
  tokens: { min: 100, max: 199 },
  assets: { min: 200, max: 299 },
} as const;

// Three-Axis SSOT exception: doc is dual-role (code-job@800 + design-job).
// Reading `task.priority` here is legal because this lives INSIDE the bundle
// (= SSOT for "my band means scheduling role X"). Code-job doc tasks sit at
// 800, so both flags resolve false for them. Phase-layer code never reads
// priority — it asks this hook.
export function classify(task: BaseTask): SchedulingClassification {
  const p = task.priority;
  return {
    isTokens: p >= DESIGN_DOC_BANDS.tokens.min && p <= DESIGN_DOC_BANDS.tokens.max,
    isFoundation: p >= DESIGN_DOC_BANDS.assets.min && p <= DESIGN_DOC_BANDS.assets.max,
  };
}

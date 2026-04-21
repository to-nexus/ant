/**
 * selectExecutionTier — (mode × complexity) → {@link ExecutionTierId} matrix SSOT.
 *
 * Reflects the 18-session-redesign §2.3 tier selection table:
 *
 *   explain × oneshot     → 0 Reflex       (read-only, minimal cost)
 *   any     × oneshot     → 1 OneShot      (1–2 step ReAct)
 *   any     × exploratory → 2 Exploratory  (ReAct with ANT_DIRECT_MAX_STEPS)
 *   any     × task        → 3 Task         (full decompose → plan → execute)
 *   (fallback)            → 4 Plan         (Mode×Complexity not applicable)
 *
 * The Plan tier covers `design` / `plan` job types that do not emit a
 * `complexity` classification; the pipeline treats them uniformly with
 * every operation strategy turned off (Noop).
 */

import type { Mode } from '@ant/shared';
import type { Complexity } from '@ant/shared';
import type { ExecutionTierId } from './types';

export function selectExecutionTier(
  mode: Mode | undefined,
  complexity: Complexity | undefined,
): ExecutionTierId {
  if (!mode || !complexity) return 4;
  if (complexity === 'oneshot' && mode === 'explain') return 0;
  if (complexity === 'oneshot') return 1;
  if (complexity === 'exploratory') return 2;
  if (complexity === 'task') return 3;
  return 4;
}

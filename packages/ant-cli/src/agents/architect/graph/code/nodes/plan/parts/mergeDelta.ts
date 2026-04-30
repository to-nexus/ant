/**
 * mergeDelta — combine a plan-node's intended return (`base`) with the
 * pending state writes produced by a plan entry handler (`delta`).
 *
 * Semantics (mixed by axis):
 *   - Top-level keys: **delta wins**. Plan-node return objects spread
 *     `...state` to carry incidental fields, which means stale incoming
 *     values (e.g. `state._executeCallIndex = 3` from the prior turn)
 *     ride along on `base`. If `base` were given precedence, the entry
 *     handler's reset (`delta._executeCallIndex = 0`) would be silently
 *     dropped. Delta-wins is also safe for intent-bearing keys the plan
 *     node sets explicitly (`_activePhase: 'plan'` from the tool_use
 *     branch, `verification: undefined` from the prePlanText fast path,
 *     etc.) because the entry handlers do NOT set those keys in their
 *     delta — JS object spread only copies own enumerable properties, so
 *     a key missing from `delta` cannot override `base`.
 *
 *   - `conversations` field: **inner-key merged with base-wins-per-key**.
 *     `conversationsReducer` shallow-merges `prev` and `next` at the
 *     channel-key level — channels not present in `next.conversations`
 *     are carried over from `prev`. The plan-LLM tool_use branch returns
 *     `conversations: { NODE_PLAN: [...result] }` and that NEW write must
 *     reach the reducer. The entry handler's `conversations: { NODE_EXECUTE:
 *     [] }` clear must reach the reducer alongside it. Inner merge with
 *     base winning per key achieves both: base.NODE_PLAN survives, delta's
 *     NODE_EXECUTE clear propagates.
 *
 * Regression: job `urban-fronting-faith` (2026-04-30). The original
 * incident reproduced inside the verification task type's retry branch,
 * which cleared NODE_EXECUTE / NODE_PLAN by mutating `state.conversations`
 * while the plan-LLM tool_use branch returned only
 * `{ conversations: { NODE_PLAN: [...] } }` — the reducer kept the OLD
 * NODE_EXECUTE and Anthropic rejected with `messages.4: tool_use ids were
 * found without tool_result blocks immediately after`. The verification
 * retry branch was retired in the verification fix-책임 제거 리팩토링
 * (verification never reaches retry under always-fan-out), but the
 * mergeDelta invariant survives: every retry/reverify entry handler still
 * clears NODE_EXECUTE via the delta carrier so the reducer commit is
 * decoupled from `state.conversations` mutation.
 *
 * (Retired companion: `_executeModifiedFiles` cross-cycle channel —
 * see `tasks/_shared/verify/router.ts` and `nodes/tool/index.ts` for
 * the turn-scoped replacement `_lastToolBatchMutatedFiles`.)
 */

import type { Conversations } from '../../../../../../common/graph/conversations';
import type { ArchitectGraphState } from '../../../state';

export function mergeDelta(
  base: Partial<ArchitectGraphState>,
  delta: Partial<ArchitectGraphState>,
): Partial<ArchitectGraphState> {
  const baseConvs = (base.conversations ?? {}) as Conversations;
  const deltaConvs = (delta.conversations ?? {}) as Conversations;
  // Base wins per channel key — base's NODE_PLAN write (the plan-LLM
  // tool_use result) must NOT be overwritten by delta's NODE_PLAN clear.
  // delta's other channel keys (e.g. NODE_EXECUTE: []) carry through.
  const mergedConvs: Conversations = { ...deltaConvs, ...baseConvs };
  return {
    ...base,
    ...delta,
    conversations: mergedConvs,
  };
}

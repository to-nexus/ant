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
 * Regression: job `urban-fronting-faith` (2026-04-30). `handleRetryEntry`
 * cleared NODE_EXECUTE / NODE_PLAN by mutating `state.conversations`; the
 * plan-LLM tool_use branch returned `{ conversations: { NODE_PLAN: [...] } }`,
 * so the reducer kept the OLD NODE_EXECUTE — Anthropic 400 `messages.4:
 * tool_use ids were found without tool_result blocks immediately after`.
 *
 * Self-review note: an earlier draft of this helper used `{ ...delta,
 * ...base }` (base-wins for top-level). That looked correct in isolation
 * but broke once paired with plan() return objects of shape
 * `{ ...state, conversations: { NODE_PLAN: [...] }, _activePhase: ... }`
 * — the `...state` spread populated `base.{_executeCallIndex,violations,
 * _planSearchWebCount,_finalTaskLoopCount}` with the prior turn's values,
 * which then beat the entry handler's resets. Conversations was the only
 * field that survived because of its explicit inner merge.
 *
 * (Field list trimmed: `_executeModifiedFiles` was retired post-
 * `urban-fronting-faith` p2 — see `tasks/_shared/verify/router.ts` and
 * `nodes/tool/index.ts` for the replacement turn-scoped signal
 * `_lastToolBatchMutatedFiles`.)
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

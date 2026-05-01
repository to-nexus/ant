/**
 * mergeDelta — combine plan-node return (`base`) with the entry-handler's
 * pending writes (`delta`).
 *
 * Top-level keys: delta wins. `base` carries `...state` which can include
 * stale incoming counters that the entry handler just reset.
 *
 * `conversations`: inner-key merged with base-wins-per-key. The plan-LLM
 * tool_use branch returns `{ NODE_PLAN: [...] }` and that NEW write must
 * reach the reducer alongside the entry handler's `{ NODE_EXECUTE: [] }`
 * clear. (Regression: `urban-fronting-faith` 2026-04-30.)
 */

import type { Conversations } from '../../../../../../common/graph/conversations';
import type { ArchitectGraphState } from '../../../state';

export function mergeDelta(
  base: Partial<ArchitectGraphState>,
  delta: Partial<ArchitectGraphState>,
): Partial<ArchitectGraphState> {
  const baseConvs = (base.conversations ?? {}) as Conversations;
  const deltaConvs = (delta.conversations ?? {}) as Conversations;
  const mergedConvs: Conversations = { ...deltaConvs, ...baseConvs };
  return {
    ...base,
    ...delta,
    conversations: mergedConvs,
  };
}

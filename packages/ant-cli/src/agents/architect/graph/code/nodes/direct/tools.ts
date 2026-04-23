/**
 * Per-node state-aware tool-set selector for the `direct` phase (single-turn
 * ReAct loop used for Tier 0 / Tier 1 execution — Tier 2+ runs on the task
 * pipeline instead).
 *
 * Conforms to the `nodes/{name}/tools.ts` contract in
 * `docs/architecture/NODE_GRAPH_LAYOUT.md §2.2`:
 *   export async function getTools(state): Promise<ToolDefinition[]>
 *
 * Tool policy (Tier-Verification Alignment SSOT):
 *   - Tier 0 Reflex → `TOOL_SETS.codeExplain` (read-only), regardless of mode.
 *     Tier 0 answers via text; writes are reserved for Tier 1+.
 *   - Tier 1 OneShot + explain mode → `TOOL_SETS.codeExplain` (read-only).
 *   - Tier 1 OneShot + generate/refactor → `TOOL_SETS.codeBasic` (full code
 *     set). The write is bounded to the oneshot ReAct budget and the prompt
 *     restricts it to verification-unneeded surfaces.
 */

import type { ArchitectGraphState } from '../../state';
import type { ToolDefinition } from '../../../../../../core/ports/llm';
import { ExecutionTierId } from '@ant/shared';
import {
  getToolsByNamesWithTemplates,
  TOOL_SETS,
  ToolName,
} from '../../../../../common/tool/toolSchemas';

export async function getTools(state: ArchitectGraphState): Promise<ToolDefinition[]> {
  const promptBuilder = state.deps?.promptBuilder;
  if (!promptBuilder) {
    throw new Error('[Direct/tools] PromptBuilder not available');
  }

  const isExplainMode = state.resolvedAction?.mode === 'explain';
  const isTier0 = state.executionTier === ExecutionTierId.Reflex;
  // Tier 0 forbids writes (read-only textual answer). Tier 1 allows writes in
  // generate/refactor modes, constrained to verification-unneeded surfaces.
  const readOnly = isTier0 || isExplainMode;
  const toolNames: ToolName[] = readOnly
    ? [...TOOL_SETS.codeExplain]
    : [...TOOL_SETS.codeBasic];

  return getToolsByNamesWithTemplates(toolNames, promptBuilder);
}

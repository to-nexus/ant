/**
 * Window-keyed compaction params for design execute message composition.
 *
 * Twin of code execute's inline derivation (code/nodes/execute/
 * buildMessages.ts, dim-beating-brass RCA): calling `composeMessages` without
 * `compactParams` compacts at the 50K default with a 5-turn hot tail — far
 * below the real model window — evicting already-gathered exploration
 * mid-task and forcing re-reads. In the design execute loop that eviction
 * lands right when the model should be writing the document
 * (sandy-building-dryad: 20 turns of reads collapsed to an 11-line summary on
 * the turn before the no-output breaker fired).
 */

import { getModelContextWindow } from '@ant/shared';
import { extractLLMInfo } from '../../../../../../../core/ports/workflow';
import type { DesignGraphState } from '../../../state';

/** Area reserve mirrored from code execute: system/project/task blocks + output/overhead margin. */
const HISTORY_RESERVED_TOKENS = 105_000;

export interface ExecuteCompactParams {
  autoCompactThreshold: number;
  autoCompactHotTail: number;
}

export function deriveExecuteCompactParams(state: DesignGraphState): ExecuteCompactParams {
  const modelId = state.deps?.llm ? extractLLMInfo(state.deps.llm).model : undefined;
  // getModelContextWindow throws on unknown/undefined modelId — never let a
  // model-table gap break message composition; fall back to the legacy 200K.
  let windowTokens = 200_000;
  try {
    if (modelId) windowTokens = getModelContextWindow(modelId);
  } catch {
    windowTokens = 200_000;
  }
  const historyBudget = Math.max(
    75_000,
    Math.min(Math.floor(windowTokens * 0.7), windowTokens - HISTORY_RESERVED_TOKENS),
  );
  return {
    autoCompactThreshold: Math.floor(historyBudget * 0.9),
    autoCompactHotTail: 8,
  };
}

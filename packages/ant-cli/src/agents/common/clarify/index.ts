/**
 * `agents/common/clarify` — SSOT module for clarify UX across every
 * agent graph (code decompose, design detect/execute, planner, visual).
 *
 * Surfaces:
 *   - `applyClarifyGate` — the ONE turn-terminating content-clarify gate
 *     (policy check + budget + parse + sendClarify + default-and-proceed).
 *     Trigger is the `<clarify>` tag (canonical surfaces).
 *   - `CLARIFY_TOOL_DEFINITION` / `clarifyBlockFromArgs` — the clarify TOOL,
 *     the unified trigger going forward (universal first; canonical surfaces
 *     migrate off the tag in follow-up commits).
 *   - `findDanglingClarifyToolUse` / `buildClarifyToolResultTurn` — the
 *     end-and-resume seam: detect a sealed dangling clarify `tool_use` and
 *     close it with the next user turn as its `tool_result`.
 *   - `sendClarify` — direct ChatAPIClient transport
 *   - `parseClarifyTags` / `stripClarifyTags` — post-stream response parser
 *   - `isIntentCommitted` / `buildIntentClarifyTemplateVars` — intent-level
 *     clarify gate (currently consumed only by `<specClarify>` in decompose)
 *
 * This barrel preserves every import path that existed when the module
 * was a single file (`agents/common/clarify.ts`). External consumers do
 * not need to update their imports.
 */

export type { ClarifyBlock, ClarifyOption } from './types';
export { sendClarify } from './transport';
export {
  parseClarifyTags,
  stripClarifyTags,
} from './tags';
export {
  isIntentCommitted,
  buildIntentClarifyTemplateVars,
} from './gate';
export type { IntentCommittedState } from './gate';
export { consumeAwaitingClarify } from './continuation';
export type { ClarifyContinuableState, ClarifyConsumePatch } from './continuation';
export { applyClarifyGate } from './phaseGate';
export type { ClarifyGateInput, ClarifyGateResult } from './phaseGate';
export { CLARIFY_TOOL_NAME, CLARIFY_TOOL_DEFINITION, clarifyBlockFromArgs } from './tool';
export { findDanglingClarifyToolUse, buildClarifyToolResultTurn } from './toolResume';
export type { DanglingClarifyToolUse } from './toolResume';

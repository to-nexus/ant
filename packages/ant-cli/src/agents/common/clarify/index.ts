/**
 * `agents/common/clarify` — SSOT module for clarify UX across every
 * agent graph (code decompose, design detect/docGen, planner, visual).
 *
 * Surfaces:
 *   - `CLARIFY_TOOL` / `handleClarify` / `ClarifyContext` — LLM tool loop
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
  CLARIFY_TOOL,
  createClarifyContext,
  handleClarify,
} from './tool';
export type { ClarifyContext } from './tool';
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
export type { ClarifyContinuableState } from './continuation';

/**
 * Shared plan-LLM constants.
 *
 * `PLAN_TOOL_LOOP_MAX` was previously declared in
 * `architect/graph/code/nodes/plan/llm/tools.ts`. The code job continues
 * to re-export the same constant from its own barrel so existing callers
 * keep working — but the SSOT now lives here so the design job can share
 * the same ceiling.
 */

/**
 * Maximum number of plan↔tool round-trips before forcing finalization.
 *
 * After this many rounds the helper expects the caller to make ONE more
 * LLM call WITHOUT tools so the model must synthesize a `<plan>` from
 * the gathered exploration context (see `finalize-from-exploration`).
 */
export const PLAN_TOOL_LOOP_MAX = 15;

/**
 * Drain-salvage execution gate — single owner of the "narrowed tools are
 * ENFORCED, not just advertised" rule.
 *
 * During drain finalization the execute node narrows the advertised tool set
 * to the write tools via `toolChoice: { allow }` (design/code
 * `drainFinalize.ts`). That narrowing is advertisement-only: OpenAI-compat
 * providers (GLM) keep emitting history-pattern tool calls that were never
 * declared this round, the server does not validate names, and the tool
 * executor dispatches any registered tool by name — so every salvage round
 * was spent executing undeclared reads until the no-output breaker discarded
 * the run (narrow-ending-flour RCA: 5 drained rounds of read_file/search_code
 * → design_no_output, cloud/GLM only).
 *
 * This gate closes the seam at EXECUTION time: bound as (or composed into)
 * the tool node's `gateCall`, it refuses any call outside the salvage
 * allow-list with an instructive error, mirroring the drain note's wording so
 * the refusal funnels the model into the write channel. A refused turn
 * produces no write sideEffects, so the no-output streak keeps rising and the
 * breaker remains the single terminal guard.
 *
 * The allow-list arrives via the `_drainSalvageTools` state channel — the
 * narrowing the LLM round ACTUALLY received. Recomputing the drain triggers
 * here instead would be off-by-one: the streak increments between the LLM
 * round and this gate, so a legitimately-advertised call could be refused.
 */

export function gateDrainSalvage(
  salvageTools: readonly string[] | null | undefined,
  call: { name: string },
): { allowed: true } | { allowed: false; error: string } {
  if (!salvageTools || salvageTools.length === 0) return { allowed: true };
  if (salvageTools.includes(call.name)) return { allowed: true };
  return {
    allowed: false,
    error:
      `${call.name} is not available — exploration is over. ` +
      `Write the final output NOW via ${salvageTools.join(' / ')}, ` +
      `then output <done>true</done>.`,
  };
}

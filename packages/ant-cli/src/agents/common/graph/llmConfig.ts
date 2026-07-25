/**
 * LLM Configuration Constants
 *
 * Ant's pipeline requires DETERMINISTIC outputs:
 * - Same PRD/design → Same code output
 * - Reproducible across runs
 * - Predictable for code review
 *
 * Temperature policy moved to `core/ports/llmSampling.ts` (SSOT — core
 * consumers like compactJob must not import from agents/). Re-exported here
 * so agent-side call sites keep their existing import path.
 */

export { LLM_TEMPERATURE } from '../../../core/ports/llmSampling';

export const LLM_THINKING_BUDGET = {
  PLAN: 10000,
  DECOMPOSE: 10000,
  CODE_EXECUTE: 5000,
  REVISE: 10000,
} as const;

export const LLM_MAX_TOKENS = {
  // Short outputs (no thinking, concise keyword responses)
  KEYWORD: 3200,

  // Default for plan / execute / verify.
  //
  // Anthropic model output ceilings (per Anthropic docs, 2026-06):
  //   - Sonnet 5 (codebase default for code.*) / Opus 4.6/4.7/4.8: 128K ceiling
  //   - Opus 4 (deprecated, retired 2026-06-15): 32K hard limit
  //
  // 64K is the safe default: within every current model's ceiling (Sonnet 5
  // and Opus 4.8 both allow 128K, so this is conservative, not a cap forced by
  // the model). With thinkingBudget 10K, text space = ~54K; with 5K, ~59K.
  //
  // Why bumped 32K → 64K (safe-braking-eagle RCA):
  // The legacy 32K cap caused silent mid-stream truncation in plan (parent
  // emits batches[] with full per-batch detail) and execute (single LLM
  // round emits a >20KB file). On `stop_reason: max_tokens` the closing
  // `</plan>` / `</file>` never arrives, the partial output is discarded,
  // and the orchestrator falls through to a fresh tool-loop — billing the
  // tokens twice with zero progress. See
  // `.claude/plans/safe-braking-eagle-id-code-enchanted-dongarra.md`.
  // Detection lives on `LLMStreamEvent.stopReason` (option A);
  // chunked-emission recovery is option C.
  //
  // Risk model: Opus 4 (deprecated) at 32K would have this rejected. Not
  // reachable from default config; only at risk if a user explicitly
  // overrides to the legacy ID before its 2026-06-15 retirement.
  DEFAULT: 64000,

  // Decompose Tier 4 may emit 30+ tasks against multi-ref design docs and
  // exhausted the legacy 32K mid-`<tasks>` block (the streaming parser
  // saw `<task>` elements but `</tasks>` never arrived, causing
  // `parseLLMResponse` to throw "Invalid response: <tasks> tag is required").
  // 64K gives ~54K text budget after thinkingBudget=10K, enough for ~150
  // tasks at typical sizes. Now identical to DEFAULT, kept as a named
  // constant for intent and so a future bump can split them again.
  DECOMPOSE: 64000,

  // Per-round output ceiling for the plan↔tool diagnostic loop
  // (`runPlanWithTools`). A diagnostic round legitimately emits either a
  // few small tool calls (read_file / search paths) or a compact
  // reasoning note — observed at 35–1,419 output tokens across a healthy
  // 36-round verify loop. The final `<plan>` JSON emission is the only
  // round that can legitimately be large; the caller escalates THAT round
  // to `DEFAULT` on truncation (see `runPlanWithTools` escalatedMaxTokens).
  //
  // Why this exists (gentle-leaping-lathe RCA): on OpenAI-compat providers
  // (GLM/DeepSeek) reasoning shares the single `max_tokens` output budget
  // and is NOT server-capped by a separate thinking budget the way
  // Anthropic's `budget_tokens`/`effort` bounds it. A diagnostic round that
  // degenerated into a repeating monologue therefore ran against the 64K
  // DEFAULT — ~10–20 min of unbounded generation on GLM throughput, never
  // returning to the graph so no router-level no-progress breaker could
  // ever fire. A 16K per-round ceiling forces the provider to terminate a
  // degenerate round (`finish_reason:length`) in ~2 min, handing control
  // back to the existing recovery path (`onMaxTokensTruncation` → fresh
  // tool-loop restart) and the no-progress streak. This is a round-shape
  // budget, NOT a thinking-time cap — legitimate large plans escalate.
  PLAN_TOOL_LOOP: 16000,

  // Per-round output ceiling for the detect slot-inference loop
  // (`inferRacWithTools`). Every round of that loop is small by shape:
  // a few read_file / list_files calls, or the final `<slots>` /
  // `<missingPrereq>` block (a few hundred tokens). There is no legitimate
  // large-emission round, so no escalation constant is paired with this cap.
  //
  // Same failure class as PLAN_TOOL_LOOP (gentle-leaping-lathe RCA):
  // lapis-oaring-drain (2026-07-25) burned all 7 tool rounds on codebase
  // exploration, then the forced tools-stripped final round ran a degenerate
  // GLM generation against the 64K DEFAULT for ~8 minutes until max_tokens
  // truncation — no `<slots>` ever arrived, and the verbatim retry
  // reproduced the same failure. An 8K ceiling terminates a degenerate
  // detect round in well under a minute and hands control back to the
  // corrective-retry path in `inferRacWithTools`.
  DETECT_TOOL_LOOP: 8000,
} as const;

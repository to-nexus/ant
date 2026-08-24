/**
 * LLM sampling policy — the single source of truth for per-call temperature.
 *
 * Ant's pipeline is dominated by STRUCTURED emission (decision tags, JSON,
 * `<tasks>` blocks, tool calls) where a format violation costs a
 * typed retry, so the table biases hard toward determinism. Every LLM call
 * site passes one of these keys explicitly; the client-constructor default
 * ({JOB}_MODEL_TEMPERATURE / AI_MODEL_TEMPERATURE env → 0.7) is only a
 * fallback for sites that predate the policy, not a policy value.
 *
 * Provider reality (enforced in the adapters, not here):
 * - Anthropic adaptive-thinking models (Sonnet 5 / Opus 5 / Fable 5): the
 *   API removed the temperature parameter — the adapter always omits it,
 *   so these keys are inert on the default Anthropic tier.
 * - Anthropic extended-thinking models (Haiku 4.5): applied only on
 *   non-thinking rounds (API forces temperature=1 with thinking enabled).
 * - OpenAI-compat hard-toggle providers (GLM / DeepSeek): applied only on
 *   non-thinking rounds — thinking rounds omit temperature entirely, because
 *   reasoning shares the completion decode stream and both vendors document
 *   low-temperature reasoning as an endless-repetition pathology
 *   (jade-hiking-penny RCA: DeepSeek-R1 README mandates 0.5–0.7, GLM-4.6
 *   card recommends 1.0; ant's 0.2–0.3 looped a plan thinking block).
 * - Real OpenAI and Gemini: applied as-is.
 *
 * Lives in core/ports (not agents/) because core consumers (compactJob,
 * breadcrumbSummary) must not import from agents/. `agents/common/graph/
 * llmConfig.ts` re-exports it for the existing agent-side import path.
 *
 * Regression guard: tests/policy/llm-temperature-ssot.test.ts — every key
 * must have ≥1 consumer (no dead keys) and no raw temperature literals may
 * appear at call sites.
 */

export const LLM_TEMPERATURE = {
  // ── Classification / decision (maximum determinism) ──
  /** detect inferRacWithTools · triage intent · inline-ask intent dispatch · visual detectStrategy */
  DETECT: 0.2,
  /** code/design decompose tool-loops · learn decompose */
  DECOMPOSE: 0.2,
  /** code/design revise — strict JSON decision ({action, reason, tasksToRemove}) */
  REVISE_DECISION: 0.2,
  /** compaction summary · breadcrumb summary — faithfulness over flair */
  SUMMARIZE: 0.2,
  /** SubagentRunner explore child loop */
  SUBAGENT_EXPLORE: 0.2,

  // ── Planning (slight flexibility, stable structure) ──
  PLAN_KEYWORD: 0.2,
  /** single-shot plan · plan tool-loop (code+design) · planner plan node */
  PLAN_GENERATION: 0.3,

  // ── Generation ──
  /** code execute stream · code direct ReAct · visual direct/engrave (exact SVG/asset code) */
  CODE_EXECUTE: 0.2,
  /** design execute/docGen · design explain · planner execute (PRD prose over a fixed skeleton) */
  DOC_GENERATION: 0.3,

  // ── User-facing conversation ──
  /** ask agent · visual explain — grounded Q&A, so 0.5 rather than the old accidental 0.7 */
  CONVERSATIONAL: 0.5,
} as const;

/**
 * Single owner of the wire rule "the client temperature reaches the request
 * only when the model accepts it on this call". The PREDICATE is provider
 * wire knowledge and stays in each adapter (Anthropic: registry thinkingMode;
 * OpenAI-compat: the per-round thinking toggle; Responses: registry
 * `supportsTemperature`; Gemini: always — an explicit verdict, see
 * `GeminiLLMClient.samplingParams`); this function owns only the application,
 * so every adapter funnels through one greppable, policy-locked name
 * (tests/policy/llm-temperature-ssot.test.ts) instead of hand-rolling the
 * same ternary under a fourth name — the fragmentation that let GLM thinking
 * rounds receive 0.3 while Anthropic thinking rounds never could
 * (jade-hiking-penny RCA).
 */
export function wireTemperature(
  sendTemperature: boolean,
  temperature: number | undefined,
): { temperature?: number } {
  if (!sendTemperature || temperature === undefined) return {};
  return { temperature };
}

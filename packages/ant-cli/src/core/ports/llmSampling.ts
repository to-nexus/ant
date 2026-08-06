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
 * - OpenAI-compat (GLM / DeepSeek / OpenAI) and Gemini: applied as-is.
 *   DeepSeek reasoner ignores it server-side (harmless).
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

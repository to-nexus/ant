/**
 * Shared plan-LLM helper types.
 *
 * Function-only utilities for the plan↔tool loop are used by both the
 * code job (entry/shortcut/RAG/llm/outcome 5-stage plan) and the design
 * job (lean per-doc plan). The helpers are intentionally NOT abstracted
 * behind an adapter/strategy interface — see this directory's README.md
 * for the rationale.
 */

import type { MessageContentBlock, ToolDefinition, LLMClient } from '../../../../../core/ports/llm';
import type { ConversationMessage } from '../../conversations';

/**
 * Loose state alias used by the shared plan-LLM helpers. Both job state
 * shapes (`ArchitectGraphState`, `DesignGraphState`) carry a richer set
 * of fields than the helper consumes, but the helper only touches
 * token-bookkeeping fields via `llmHelpers` (which themselves cast to
 * loose types). Using `any` here avoids forcing an awkward shared base
 * interface — see this directory's README for the rationale.
 */
export type MinimalPlanState = Record<string, any>;

/**
 * Tool call captured during a single plan-LLM round.
 */
export interface PlanToolCall {
  id: string;
  name: string;
  args: Record<string, any>;
}

/**
 * LLM response payload for the tool-use branch — caller persists this
 * to its own state shape (e.g. as `state.llmResponse`) before short-
 * circuiting to the tool node.
 */
export interface PlanLLMResponse {
  toolCalls: PlanToolCall[];
  textResponse: string;
  thinking?: string;
  thinkingSignature?: string;
  done: false;
  tokenUsage?: any;
}

/**
 * Result of one plan-LLM round driven by `runPlanWithTools`.
 *
 * - `planText` — the LLM emitted a `<plan>...</plan>` block with
 *   sufficient length. Caller treats this as the sealed plan and routes
 *   to the next phase (e.g. execute / docGen).
 * - `toolCalls` — the LLM chose tool calls. Caller persists `llmResponse`
 *   and `nodePlanHistory` (assistant message appended), sets `_activePhase`
 *   to its plan marker, and yields control back to the graph so the tool
 *   node can run.
 * - `null` — pre-flight aborted (no LLM, no tools, no stream support, or
 *   neither plan text nor tool calls produced). Caller falls through to
 *   its own fallback (e.g. single-shot generatePlanText or finalize).
 */
export type PlanRoundResult =
  | { kind: 'planText'; planText: string }
  | { kind: 'toolCalls'; llmResponse: PlanLLMResponse; assistantMessage: ConversationMessage }
  | null;

/**
 * Outcome of `runPlanToolLoopPhase` — caller decides how to update its
 * state shape based on the kind.
 *
 * - `planText` — the in-loop round produced a `<plan>` block. Caller
 *   persists planText and routes onward.
 * - `toolCalls` — same as `PlanRoundResult.toolCalls`; caller short-circuits
 *   to tool node.
 * - `fallthrough` — neither plan text nor tool calls produced. Caller falls
 *   through to its single-shot fallback (or treats as failure for design,
 *   which has no single-shot path).
 */
export type PlanLoopOutcome =
  | { kind: 'planText'; planText: string }
  | { kind: 'toolCalls'; llmResponse: PlanLLMResponse; assistantMessage: ConversationMessage }
  | { kind: 'fallthrough'; reason: 'no-output' };

/**
 * Arguments accepted by `runPlanWithTools`. The helper is intentionally
 * function-shaped (not a class) — caller pre-resolves the LLM, tools,
 * and prompt building.
 */
export interface RunPlanWithToolsArgs<TState extends MinimalPlanState = MinimalPlanState> {
  state: TState;
  /** Conversation messages to send (pre-built blocks/strings). */
  messages: Array<{ role: 'user' | 'assistant'; content: string | MessageContentBlock[] }>;
  /** Pre-resolved LLM client (caller handles model selection). */
  llm: LLMClient;
  /** Pre-collected tool definitions (caller chooses tool set). */
  tools: ToolDefinition[];
  /** Whether to enable extended thinking on this round. */
  enableThinking: boolean;
  /** Thinking budget tokens (only used when enableThinking). */
  thinkingBudget?: number;
  maxTokens: number;
  /** Task name for UI streaming (chat status / plan title). */
  taskName: string;
  /** Job type for the streaming render strategy. */
  jobType: 'code' | 'design';
  /**
   * Optional per-round token-usage hook. Called once at the `done` event
   * with the parsed usage. Caller can accumulate to job/task counters.
   * Awaited — return a Promise to perform async accumulation safely.
   */
  onTokenUsage?: (usage: any) => void | Promise<void>;
  /**
   * Optional truncation hook. Fires when the stream's `done` event reports
   * `stopReason === 'max_tokens'` — the LLM hit its output ceiling and
   * the response was cut off mid-stream. Caller can log to its
   * `executionLogger`, raise a UI warning, etc. The helper itself does
   * NOT recover; that lives in the caller's fallthrough path.
   *
   * RCA: safe-braking-eagle (architect (9)/(10)). The 32K silent cliff
   * looked like a normal completion because nothing observed `stop_reason`.
   */
  onMaxTokensTruncation?: (info: { outputTokens: number; round: number }) => void | Promise<void>;
  /**
   * Minimum length for a `<plan>...</plan>` block to be accepted. Below
   * this threshold the helper ignores the match and falls through to
   * tool-call/fallthrough handling. Default: 50.
   */
  minPlanLength?: number;
}

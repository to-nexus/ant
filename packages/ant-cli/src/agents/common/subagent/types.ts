import type { TaskTokenUsage, SubagentTerminalState } from '@ant/shared';
import type { ToolExecutionContext, ToolCall } from '../tool/types';
import type { ToolRegistry } from '../tool/registry';
import type { ToolDefinition } from '../../../core/ports/llm';

export type SubagentJobKind = 'code' | 'design' | 'planner' | 'ask' | 'universal';

export interface SubagentResult {
  /** Distilled report (error-shaped on failure — the runner never throws). */
  report: string;
  /**
   * Complete untruncated report — set only when `report` was compacted to fit
   * the inline budget. Feeds the chat card (human drill-down) and the
   * process-local report store (`subagent_report` tool drill-down).
   */
  reportFull?: string;
  usage?: TaskTokenUsage;
  /** Child model id, for per-model billing attribution at fold time. */
  modelId?: string;
  rounds: number;
  state: SubagentTerminalState;
}

export interface SubagentEntry {
  /** Parent tool_use callId — globally unique within the conversation. */
  id: string;
  /** `${jobId}:${workerScopeKey}` — isolates parallel task workers. */
  ownerKey: string;
  goal: string;
  status: 'running' | 'settled';
  /** Settles when the runner finishes; never rejects. */
  promise: Promise<void>;
  result?: SubagentResult;
  launchedAt: number;
  /** Double-drain guard: set inside collectCompleted. */
  delivered: boolean;
  /** Launch card id — terminal card folds onto it via _mergeIndex. */
  chatCardId?: string;
}

export type SubagentGate = (call: ToolCall) => { allowed: true } | { allowed: false; error: string };

/** Minimal render surface the runner needs (PromptBuilder satisfies it). */
export interface SubagentPromptRenderer {
  render(templatePath: string, vars: Record<string, unknown>): Promise<string>;
}

/**
 * Everything a child run needs, captured from the parent job's tool context
 * at seam-creation time. Job-specific by construction; the runner is job-blind.
 */
export interface SubagentSeamInternals {
  jobKind: SubagentJobKind;
  /** LLMContext.jobType for the child client (parent job's value). */
  llmJobType: string;
  workspaceConfig?: unknown;
  /**
   * Parent job's ToolExecutionContext. Each child run shallow-clones it with
   * chatStatus swapped to a no-op and `subagent` removed (depth-1, layer 2).
   */
  baseCtx: ToolExecutionContext;
  /** Per-call policy gate (code: RAC scope; planner: codebase gate; design/ask: none). */
  gate?: SubagentGate;
  /** Job preset registry used to dispatch child tool calls. */
  registry: ToolRegistry;
  /** Advertised child tool schemas (read-only set — never contains `explore`). */
  childTools: ToolDefinition[];
  promptBuilder?: SubagentPromptRenderer;
}

export interface SubagentSeam {
  ownerKey: string;
  jobKind: SubagentJobKind;
  /**
   * Launch a child. Resolves immediately (does NOT wait for the child):
   * `ack` (launch acknowledgment tool result) or `denied` (concurrency cap /
   * missing deps — no child started).
   */
  launch(callId: string, goal: string, hints?: string[]): Promise<{ ack: string } | { denied: string }>;
}

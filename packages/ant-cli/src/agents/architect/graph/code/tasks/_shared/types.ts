/**
 * TaskHooks — polymorphic dispatch surface for task-type-specific logic.
 *
 * Phase nodes (nodes/), routers (routers/), parallel orchestration
 * (parallel/), and common tool handlers are blind to `task.type`. Any
 * behaviour that would otherwise require `if (task.type === '...')` lives
 * behind one of the optional hook members below.
 *
 * Rules (see docs/architecture/NODE_GRAPH_LAYOUT.md):
 *   R1 — Phase layer is blind; it only calls `hooksIfActive(state)?.X`
 *        or `hooksForTaskType(taskType)?.X`.
 *   R2 — Hook implementations depend on `tasks/{type}/model/` only.
 *
 * Individual hook signatures stay loose (`any` for plan/tool/command
 * contexts) because their concrete types are introduced later (T3, T5).
 * Once the Session / Snapshot model and phase context types land, the
 * `any` placeholders will be narrowed.
 */
import type { ArchitectGraphState, Violation } from '../../state';
import type { CodeTask } from '../../../../types/task';
import type { TaskType } from '@ant/shared';
import type { ToolExecutionContext, ToolExecutionEvent, ToolResult } from '../../../../../common/tool/types';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Placeholder types (fleshed out in T3 / T5)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Plan-node entry classification. Concrete union refined by tasks/verification/model. */
export type PlanEntry = 'fresh' | 'resumed' | 'toolLoop' | 'retry' | 'reverify';

/** Plan-node outcome union. Concrete shape owned by tasks/verification/model/outcome.ts. */
export type PlanOutcome = { kind: string; [k: string]: unknown };

/** Subset of `PlanOutcome` narrowed to `kind: 'terminal'`. */
export type TerminalOutcome = PlanOutcome & { kind: 'terminal' };

/** Batch-split descriptor returned by `plan.maybeSplit`. */
export type SplitResult = Record<string, unknown>;

/**
 * Prompt-build context passed to `plan.buildPrompt` / `plan.extraTemplateVars`.
 *
 * Replaces the seven-argument `buildPlanPrompt(state, task, projectCodeContext,
 * violationsText, uiDoc, remainingTasks, options)` signature as the single
 * carrier the phase layer hands hooks when composing plan prompts (T6b-β).
 * Task-specific hooks read only the fields they need; the phase layer fills
 * every slot so hooks do not reach back into the graph state for data.
 */
export interface PlanPromptCtx {
  state: ArchitectGraphState;
  task: CodeTask;
  projectCodeContext: unknown;
  violationsText: string | undefined;
  uiDoc: string | undefined;
  remainingTasks: Array<{
    id: string;
    name: string;
    description: string;
    priority: number;
  }> | undefined;
  options?: { hasTools?: boolean };
}

/** General plan-node context passed to `plan.allowedTools`. */
export type PlanCtx = { state: ArchitectGraphState; [k: string]: unknown };

/** Tool schema placeholder — real type emerges when plan hooks shape allowed-tool output. */
export type ToolSchema = Record<string, unknown>;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Hook interfaces
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Environment inputs sampled by the phase layer before calling
 * `initSession`. Keeps the Session constructor decoupled from phase helpers
 * (`isTypeScriptProject`, `detectTestFilesFromDisk`) so the hook layer stays
 * pure wrt `tasks/{type}/model/`. Populated by `nodes/plan/parts/entry.ts`.
 */
export interface InitSessionEnv {
  isTs: boolean;
  hasTests: boolean;
}

export interface TaskPlanHook {
  /**
   * Idempotent session hydration called at plan-node entry. Task types that
   * carry a session (currently only `verification`) populate `state.{type}`
   * here; non-session task types leave this undefined. Callers must invoke
   * this BEFORE any subsequent hook (onEntry, onCommand, etc.) so those
   * hooks may assume the session exists.
   *
   * Introduced in T4b-α so `state.verification` is populated on every
   * fresh / retry / reverify plan entry, not only on resume. Before T4b-α
   * the session was only rehydrated from carry-over; fresh entries fell
   * back to the legacy `_verification*` fields.
   */
  initSession?(state: ArchitectGraphState, env: InitSessionEnv): void;
  onEntry?(state: ArchitectGraphState, reason: PlanEntry): Promise<void> | void;
  /**
   * Fully override the plan-prompt string. Return the composed prompt (already
   * concatenated with any basis section). Used by verification / error whose
   * prompts live under dedicated `jobs/code/nodes/plan/variants/{type}/base`
   * templates and bypass the generic `jobs/code/nodes/plan/base` path.
   */
  buildPrompt?(ctx: PlanPromptCtx): Promise<string> | string;
  /**
   * Contribute extra template variables merged into the generic plan base
   * render. Used by task types that mostly follow the generic path but need
   * to inject a small, type-specific slot (e.g. setup's `setupConstraints`).
   * Ignored when `buildPrompt` returns an override.
   */
  extraTemplateVars?(ctx: PlanPromptCtx): Promise<Record<string, unknown>> | Record<string, unknown>;
  /**
   * Template path logged by the plan-toolLoop prompt recorder. Replaces the
   * three-way `task.type === 'verification' | 'error'` branch previously
   * inlined in `planGeneration.ts runPlanLLMWithTools`. Task types that do
   * not publish a dedicated variant leave this undefined and the logger
   * falls back to the generic plan-tools-batch template.
   */
  toolLoopLogTemplate?: string;
  allowedTools?(ctx: PlanCtx): ToolSchema[];
  decideOutcome?(state: ArchitectGraphState, planText: string): PlanOutcome;
  maybeSplit?(state: ArchitectGraphState, planText: string): SplitResult | null;
  makeTerminalError?(state: ArchitectGraphState, outcome: TerminalOutcome): Error;
  classifyEntry?(state: ArchitectGraphState): PlanEntry | null;
}

export interface TaskToolHook {
  onEvent(state: ArchitectGraphState, event: ToolExecutionEvent): void;
}

export interface TaskCommandHook {
  guard(ctx: ToolExecutionContext, args: { command: string }): ToolResult | null;
}

export interface TaskCheckHook {
  /**
   * Return a type-specific violation, if any. Sync return is preferred for
   * the common case (verification gate check reading only session state);
   * async return is allowed for hooks that need filesystem / IO access
   * (e.g. test-code guard that verifies real test files were written).
   */
  evaluate(state: ArchitectGraphState): Violation | null | Promise<Violation | null>;
  /**
   * Optional hint rendered on the `budget_exhausted` violation's
   * `suggestedFix` when this task type hits the call-budget guard.
   * Replaces the legacy `task.type === 'verification'` branch at
   * `graph.ts` L120 / `workerGraph.ts` L156. Task types that omit the
   * hint get the generic "break down the scope" message.
   */
  budgetExhaustedHint?: string;
}

export interface TaskRouterHook {
  shortCircuitAfterPlan?(state: ArchitectGraphState): boolean;
  routeAfterDone?(state: ArchitectGraphState): string | null;
}

/**
 * Context handed to `onTaskComplete` after a task is marked complete. Matches
 * the superset of fields both entry points need:
 *
 *   - sequential (`nodes/checkTaskStatus/index.ts`)
 *   - parallel orchestrator (`parallel/TaskOrchestrator` → `graph.ts`
 *     parallelOrchestrator.onTaskComplete callback)
 *
 * Hooks read what they need; unused fields stay undefined in the caller
 * that does not own them. `queueSnapshot` / `runningSnapshot` /
 * `completedSnapshot` are pre-materialised arrays so the hook never
 * touches the live queue mid-iteration (safe for concurrent workers).
 */
export interface TaskCompleteCtx {
  task: CodeTask;
  taskQueue: { push(task: CodeTask): void } | undefined;
  /** Snapshot of pending-queue tasks at completion time. */
  queueSnapshot: readonly CodeTask[];
  /** Snapshot of currently-running tasks (parallel only; [] in sequential). */
  runningSnapshot: readonly CodeTask[];
  /** Snapshot of already-completed tasks (parallel only; [] in sequential). */
  completedSnapshot: readonly CodeTask[];
  /** Resolved basis context required to seed follow-up tasks. */
  resolvedAction: ArchitectGraphState['resolvedAction'] | undefined;
}

export interface TaskOrchestratorHook {
  /**
   * True when this task type owns a unified attempt counter on its
   * session (verification only, at the moment). False / undefined means
   * the orchestrator should consult its shared `retries` counter.
   */
  hasOwnAttemptCounter?: boolean;
  /** Only read when `hasOwnAttemptCounter === true`. */
  attemptCount?(task: CodeTask): number;
  attachSnapshot?(task: CodeTask, snap: unknown): void;
  captureOnFailure?: boolean;
  restoreIntoWorkerState?(workerState: Record<string, unknown>, resume: unknown): void;
  /**
   * Invoked AFTER a task is marked complete but BEFORE the next worker is
   * spawned. Replaces the inline `task.type === 'error'` auto-add-final-
   * verification branches at `graph.ts` L309 (sequential checkTaskStatus)
   * and L511 (parallelOrchestrator.onTaskComplete). Hooks may mutate the
   * task queue (e.g. push a follow-up task) but MUST NOT reach back into
   * arbitrary graph state.
   */
  onTaskComplete?(ctx: TaskCompleteCtx): void;
}

export interface TaskDecomposeHook {
  classify?(rawTask: unknown): { type: TaskType; priority?: number } | null;
  isExclusive?(task: CodeTask): boolean;
}

export interface TaskConversationsHook {
  convKey(task: CodeTask): string;
}

export interface TaskSchedulingHook {
  // ─── Consumer-side flags (this task type is BLOCKED by the named barrier) ───
  preIntegrationBarrier?: boolean;
  preTestgenBarrier?: boolean;
  preDocBarrier?: boolean;
  preUiBarrier?: boolean;

  // ─── Producer-side flags (running/queued tasks of this type ACTIVATE the named barrier) ───
  //
  // Replaces the three module-level predicates that used to live inside
  // `parallel/TaskOrchestrator.ts` (`isFeatureOrSetupTask`, `isPreDocTask`,
  // `isNonIntegrationFeatureTask`). The orchestrator iterates all
  // running/queued tasks and asks each bundle via these flags whether it
  // should participate in a barrier's "work pending" check — no more
  // `task.type === 'feature' | 'setup' | 'test-code'` branches in the
  // parallel layer.
  //
  // The integration barrier ALSO requires a cross-type priority window
  // (FEATURE_CRITICAL..INTEGRATION_MIN); that window stays inline in the
  // orchestrator because it is priority-based, not type-based.
  blocksUi?: boolean;
  blocksTestgen?: boolean;
  blocksDoc?: boolean;
  blocksIntegration?: boolean;
}

/**
 * Thin polymorphic marker: each task type supplies whichever hook slots are
 * relevant. Unimplemented slots stay `undefined` so phase-layer callers can
 * short-circuit via optional chaining.
 */
export interface TaskHooks {
  plan?: TaskPlanHook;
  tool?: TaskToolHook;
  command?: TaskCommandHook;
  check?: TaskCheckHook;
  router?: TaskRouterHook;
  orchestrator?: TaskOrchestratorHook;
  decompose?: TaskDecomposeHook;
  conversations?: TaskConversationsHook;
  scheduling?: TaskSchedulingHook;
}

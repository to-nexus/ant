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
 * Slots are additive: add a new member only when a concrete publisher and
 * a concrete phase-layer consumer land in the same change. Interface
 * entries without a consumer are dead API surface and get removed on
 * sight (see prior follow-up reviews for `onEntry` / `classifyEntry` /
 * `shortCircuitAfterPlan` / `decideOutcome` / `maybeSplit` /
 * `makeTerminalError` / `attachSnapshot` / `captureOnFailure` /
 * `allowedTools` / `classify`).
 *
 * The same rule applies to public surface exported by `tasks/{type}/
 * model/` and supporting types (retired with the hook slots above):
 * `tasks/error/model/ErrorTaskData` (`readErrorData` / `hasPrePlanText`
 * / `ErrorTaskData` / `RemediationMode` — every phase consumer read
 * the four fields directly off `CodeTask` instead) and
 * `tasks/verification/model/gates.GateConfig` (no importer since the
 * interface was introduced; `Session` holds the three sets as private
 * fields rather than a combined value).
 *
 * T6b-α follow-up (plan-node decomposition, `nodes/plan/parts/*`)
 * narrowed six file-local helpers from `export` to module-scope because
 * every use site sat inside the defining module: `isTypeScriptProject` /
 * `recomputeInstallNeeded` (entry.ts), `stripMarkdownFences` /
 * `computeBatchFileOverlap` (batchSplit.ts), `EMPTY_CONTEXT` (rag.ts),
 * `enrichContextFromPlanToolLoop` (planLLM.ts). Named return types
 * (`PlanRagResult`, `PlanToolLoopOutcome`, `PlanEntryContext`) stay
 * exported because they carry API-documentation value and one of them
 * (`PlanEntryContext`) is re-exported through `nodes/plan/index.ts`.
 */
import type { ArchitectGraphState, Violation } from '../../state';
import type { CodeTask } from '../../../../types/task';
import type { TaskType } from '@ant/shared';
import type { ToolExecutionContext, ToolExecutionEvent, ToolResult } from '../../../../../common/tool/types';

/**
 * Fallback task-type used when the decompose LLM omits the `type` field
 * on an emitted task. Historically the phase layer fell back to the
 * literal 'feature' inline at `nodes/decompose/responseParser.ts` via
 * `task.type || <feature-literal>`; exposing the constant here
 * centralises the default so the only literal comparison lives inside
 * `tasks/feature/model/is.ts` (R1-compliant).
 */
export const DEFAULT_TASK_TYPE: TaskType = 'feature';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Shared context types
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Plan-node entry classification. Concrete union refined by tasks/verification/model. */
export type PlanEntry = 'fresh' | 'resumed' | 'toolLoop' | 'retry' | 'reverify';

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
   * this BEFORE any subsequent hook so those hooks may assume the session
   * exists.
   *
   * Introduced in T4b-α so `state.verification` is populated on every
   * fresh / retry / reverify plan entry, not only on resume. Before T4b-α
   * the session was only rehydrated from carry-over; fresh entries fell
   * back to the legacy `_verification*` fields.
   */
  initSession?(state: ArchitectGraphState, env: InitSessionEnv): void;
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
  /**
   * Re-seed the worker subgraph's initial state with a task-type-specific
   * snapshot carried on `task.resumeState`. Called from
   * `TaskWorker.executeTask` after the task-type-blind restore block
   * rebuilds the cross-task fields (planText / conversations / etc).
   *
   * Verification rebuilds `state.verification` from its
   * `VerificationSnapshot`; non-session task types omit the hook and the
   * call is a no-op.
   *
   * Note: snapshot *capture* / *attach* remains task-type-blind — the
   * orchestrator writes the full `WorkerSnapshot` onto `task.resumeState`
   * at all three carry-over boundaries (transient re-queue, interruption,
   * batch split) because the cross-task fields (planText / conversations
   * / projectCodeContext / retries / violations / enforcementHistory)
   * must be preserved regardless of `task.type`. Restore is the only
   * asymmetric side because it needs to revive the session *instance*
   * from its plain-object snapshot projection.
   */
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
  isExclusive?(task: CodeTask): boolean;
}

export interface TaskConversationsHook {
  convKey(task: CodeTask): string;
}

/**
 * Context passed to execute-node hooks. The `buildMessages` adapter fills
 * every slot before calling the hook so hooks never read back into graph
 * state beyond what is exposed here (mirrors the `PlanPromptCtx` pattern
 * introduced in T6b-β).
 */
export interface ExecutePromptCtx {
  state: ArchitectGraphState;
  task: CodeTask;
  /** `ProjectCodeContext` from the plan node (post-compaction). Kept loose
   *  to avoid coupling this type module to `nodes/plan/combineCodeContext`. */
  projectCodeContext: unknown;
}

/**
 * Execute-node polymorphic surface.
 *
 * Replaces the task-type literal cascades inside
 * `nodes/execute/buildMessages.ts` (template selection, directive
 * sanitisation, heavy-context gating, runtime-context framing, empty-plan
 * fallback, dirTree inclusion). Each slot is optional — unimplemented
 * slots cause `buildMessages` to fall back to its generic default path
 * (feature tasks, explain tasks). R1: the node never inspects
 * `task.type`; it only consults `hooksIfActive(state)?.execute`.
 *
 * Framing for remediation-style plans (verification / error) uses the
 * JSON diagnostic/modify/create/delete schema; feature-style plans use
 * the implementation-plan schema. The node does not know which schema is
 * active — it reads `runtimePlanFraming` straight from the hook.
 */
export interface TaskExecuteHook {
  /**
   * Variant template paths. When undefined the generic
   * `jobs/code/nodes/execute/variants/default/{base,rules}` pair is used.
   */
  templatePaths?: { base: string; rules: string };
  /**
   * Skip the injected examples block (`jobs/code/base/examples`). Replaces
   * the pre-T6b-ι `skipHeavyContext` OR chain + `taskType !== 'setup'`
   * guard in `nodes/execute/buildMessages.ts`.
   */
  skipExamples?: boolean;
  /**
   * Skip Foundation Contract + Schema Anchor cross-task injections.
   * Replaces the pre-T6b-ι `isVerification ? null : ...` gate on
   * `buildFoundationContract` / `buildSchemaAnchor`. Only verification
   * publishes this because its prompt fixes existing files rather than
   * creating new ones that would need cross-task symbol visibility.
   */
  skipCrossTaskContext?: boolean;
  /** Transform the user directive before it is rendered into the prompt. */
  sanitizeDirective?(directive: string): string;
  /** Extra template vars merged into the base render. */
  extraTemplateVars?(ctx: ExecutePromptCtx): Record<string, unknown>;
  /**
   * Runtime-context plan section label/description. Undefined keeps the
   * generic "IMPLEMENTATION PLAN" framing.
   */
  runtimePlanFraming?: { label: string; description: string };
  /** Fallback line shown in runtime context when `state.planText` is empty. */
  emptyPlanFallback?(task: CodeTask): string | null;
  /** Whether to append `projectCodeContext.directoryTree` to runtime context. */
  includeDirectoryTree?: boolean;
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
  execute?: TaskExecuteHook;
  tool?: TaskToolHook;
  command?: TaskCommandHook;
  check?: TaskCheckHook;
  router?: TaskRouterHook;
  orchestrator?: TaskOrchestratorHook;
  decompose?: TaskDecomposeHook;
  conversations?: TaskConversationsHook;
  scheduling?: TaskSchedulingHook;
}

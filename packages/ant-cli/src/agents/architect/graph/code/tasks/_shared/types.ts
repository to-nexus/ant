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
 * `tasks/_shared/verify/gates.GateConfig` (no importer since the
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
import type { BaseTask, TaskType } from '@ant/shared';
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

/**
 * Plan-node entry classification — explicit reason set by `checkTaskStatus`
 * when it routes back to plan for a retry. Fresh-task entry is encoded as
 * `undefined`; tool-loop re-entry is detected via `_activePhase === 'plan'`
 * and bypasses this channel; Tier-2 self-verify reverify entry is detected
 * by `resolvePlanEntry` from observable channel state (`_activePhase`,
 * `llmResponse.done`, `currentTask`, `planText`) and also bypasses this
 * channel. A `'reverify'` value was retired alongside its only writer (the
 * `executeRouter` conditional-edge mutation, which never propagated to the
 * next node — see `markVerifyEntered.ts` anti-pattern note).
 */
export type PlanEntry = 'retry';

/**
 * Prompt-build context passed to `plan.buildPrompt` / `plan.extraTemplateVars`.
 *
 * The single carrier the phase layer hands hooks when composing plan prompts.
 * Task-specific hooks read only the fields they need; the phase layer fills
 * every slot so hooks do not reach back into the graph state for data.
 *
 * `codeContext` is the plan-node's local RAG result (files + directoryTree +
 * gitDiff) — a pure parameter, NOT a state channel. Hooks may render it
 * into the variant template via `formatCodeContext`. Opaque `unknown` keeps
 * this type module decoupled from `nodes/plan/rag/combine`.
 */
export interface PlanPromptCtx {
  state: ArchitectGraphState;
  task: CodeTask;
  codeContext: unknown;
  violationsText: string | undefined;
  uiDoc: string | undefined;
  remainingTasks: Array<{
    id: string;
    name: string;
    description: string;
    priority: number;
  }> | undefined;
  options?: { hasTools?: boolean };
  /** Pre-loaded `codebase/ANTRULES.md` content; `undefined` when absent. */
  antrulesContent: string | undefined;
}

/**
 * Result from `TaskPlanHook.buildPrompt`.
 *
 * Hooks may return either a plain string (back-compat) or this object so they
 * can publish a variable snapshot (`vars`) that the phase layer merges into
 * the `logPrompt` `injectedVariables` payload. Without this the
 * `Injected Variables` section in `prompt-*.md` logs can only record values
 * the phase layer directly sees — variant-specific template variables the
 * hook injects (e.g. verification's `dependencyStatus`, `cachedPassedSteps`)
 * would be invisible to debug observation.
 *
 * The contract is R1-compliant: hooks stay responsible for their variant's
 * variable vocabulary; the phase layer just spreads the snapshot into its
 * logging payload and never inspects individual keys.
 */
export interface PlanPromptResult {
  /** Fully-assembled prompt string (same value the hook used to return). */
  text: string;
  /** Template-rendered variable snapshot for debug logging only. */
  vars?: Record<string, unknown>;
}

/**
 * Normalise a `buildPrompt` return value into a `PlanPromptResult`.
 * Keeps call sites blind to the union shape.
 */
export function toPlanPromptResult(value: string | PlanPromptResult): PlanPromptResult {
  return typeof value === 'string' ? { text: value } : value;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Hook interfaces
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface TaskPlanHook {
  /**
   * Fully override the plan-prompt string. Return the composed prompt (already
   * concatenated with any basis section). Used by verification / error whose
   * prompts live under dedicated `jobs/code/nodes/plan/variants/{type}/base`
   * templates and bypass the generic `jobs/code/nodes/plan/base` path.
   *
   * Hooks may return either a plain string (legacy) or a `PlanPromptResult`
   * with a `vars` snapshot for debug-log visibility. The phase layer
   * normalises both shapes through `toPlanPromptResult()`.
   */
  buildPrompt?(ctx: PlanPromptCtx): Promise<string | PlanPromptResult> | string | PlanPromptResult;
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
  /**
   * Does this task type produce a JSON plan-text body via `generatePlanText`?
   * Default `true`. `false` for tasks where the plan phase is only a
   * diagnostic / dispatch surface (verification — gates only ; doc /
   * explain — direct narrative).
   */
  requiresPlanText?: boolean;
  /**
   * Does this task type drive the plan↔tool loop? Default = `requiresPlanText`.
   * Verification is the one task where the two diverge: `requiresPlanText=false`
   * (no plan body) but `usesToolLoop=true` (the loop runs gate / inspect
   * commands).
   */
  usesToolLoop?: boolean;
  /**
   * Skip plan-text generation but STILL route to execute (do NOT treat the
   * empty plan as a no-op completion). Default `false`.
   *
   * The empty-`planText` "no-op complete" sentinel in `outcome/finalize.ts`
   * originates from the plan↔tool loop emitting a parseable no-op JSON
   * (verification / Tier-2 self-verify: "nothing left to fix" ⇒ done). A
   * task type whose plan phase produces no body precisely because it renders
   * its output directly in execute (doc → docgen narrative) must NOT be
   * caught by that sentinel — it has real execute work to run.
   *
   * Set `true` ONLY for types that combine `requiresPlanText:false +
   * usesToolLoop:false` AND own an execute hook. `explain` is intentionally
   * NOT set here: it has no execute variant, so routing it to execute would
   * fall back to the default code-execution rules (see plan §ancient-eagle).
   */
  skipPlanRunExecute?: boolean;
  /**
   * When `task.exclusive === true`, does this task type activate the
   * paths-only RAG fast path? Verification publishes `true` so its plan
   * loads only config files + entry points (source surface is the build
   * error output).
   */
  exclusiveFastpath?: boolean;
  /**
   * Task-type-specific RAG retrieval quota override. Caps the total file
   * count delivered to the plan-prompt code context. `undefined` falls
   * back to the integration/foundation vs general defaults in
   * `RETRIEVAL_CONFIG`.
   */
  ragQuota?: number;
  /**
   * Does this task type accept a pre-planned `prePlanText` body and
   * bypass the plan-tool-loop entirely (identity-shortcut: `state.planText
   * := task.prePlanText`)? Only `error` publishes `true` — the parent's
   * diagnostic IS the plan, and re-running a plan-tool-loop would cascade
   * (re-derive what verification just observed).
   *
   * Other batch-split sub-types (`test-code` / `feature` / `ui`) carry a
   * `prePlanText` body but MUST enter the plan-tool-loop so the LLM can
   * verify the parent's predicted exports against actual sibling outputs
   * before emitting `planText` (drift detection). The pre-plan is surfaced
   * as plan-tool-loop INPUT via
   * `nodes/plan/injections/parent-pre-plan.md`, not consumed as the plan
   * itself.
   */
  acceptsPrePlanText?: boolean;
}

export interface TaskToolHook {
  onEvent(state: ArchitectGraphState, event: ToolExecutionEvent): void;
}

export interface TaskCommandHook {
  /**
   * Inspect a `run_command` invocation and either reject it (returning a
   * policy-tagged `ToolResult`) or let it proceed (returning `null`). The
   * `verifies` argument is the LLM's gate-intent declaration on the
   * `run_command` tool call; it is the sole SSOT for "which gate this
   * command exercises" — the previous regex-based command-string
   * inference was retired (see
   * `docs/tmp/gate-classification-postmortem.md`). `Gate` is left as a
   * `string` here to keep `_shared/types.ts` free of model imports;
   * publishers narrow it via their own `Gate` import.
   */
  guard(ctx: ToolExecutionContext, args: { command: string; verifies?: string }): ToolResult | null;
}

export interface TaskCheckHook {
  /**
   * Return a type-specific violation, if any. Optional — task types
   * without check-time invariants leave the slot undefined.
   */
  evaluate?(state: ArchitectGraphState): Violation | null | Promise<Violation | null>;
  /**
   * Optional hint rendered on the `no_done_signal` violation's
   * `suggestedFix` when this task type reaches checkTaskStatus without a
   * `<done>` signal (Safety Net exit). Task types that omit the hint get
   * the generic "break down the scope" message.
   */
  noDoneSignalHint?: string;
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
   * Invoked AFTER a task is marked complete but BEFORE the next worker is
   * spawned. Replaces the inline `task.type === 'error'` auto-add-final-
   * verification branches in the orchestrator. Hooks may mutate the
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
 * state beyond what is exposed here.
 */
export interface ExecutePromptCtx {
  state: ArchitectGraphState;
  task: CodeTask;
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
   * Skip the Schema Anchor cross-task injection (migration table/column shape).
   * Only verification publishes this because its prompt fixes existing files
   * rather than creating new ones that would need cross-task schema visibility.
   * (The former name-only "Foundation Contract" dump was removed — its half-truth
   * symbol names caused contract drift; consumers now read authoritative source
   * via `search_code`/`read_file` per the execution-context-discipline principle.)
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
}

/**
 * Per-task scheduling classification. Returned by `TaskSchedulingHook.classify`.
 *
 * All flags are optional — a bundle need only populate the flags it cares
 * about. `undefined` is treated as `false` by every phase-layer consumer
 * via the `schedClassify(t, flag)` helper in
 * `parallel/TaskOrchestrator.ts`.
 *
 * Three-Axis SSOT (`AGENTS.md` "Three-Axis Task Modeling"):
 *
 * | Bundle           | Input read by classify       | Decided observer |
 * |------------------|------------------------------|------------------|
 * | feature          | `task.band`                  | Orchestrator     |
 * | setup            | (ignored — type-fixed)       | Orchestrator     |
 * | design-system    | (ignored — type-fixed)       | Orchestrator     |
 * | verification     | (ignored — type-fixed)       | Orchestrator     |
 * | doc (design-job) | `task.priority` (band hint)  | Orchestrator     |
 *
 * Bundles read whatever discriminator their type uses; `priority`
 * comparisons are LEGAL inside `tasks/{type}/hooks/scheduling.ts` because
 * that file IS the SSOT for "my band means scheduling role X" — but they
 * are FORBIDDEN in phase-layer code (orchestrator/router/parallel/nodes).
 * The decompose `priority → band` mapping (`responseParser.ts`) is the
 * one phase site that may translate priority into a semantic band, after
 * which `task.band` is the SSOT for feature scheduling decisions.
 */
export interface SchedulingClassification {
  isTokens?: boolean;
  isFoundation?: boolean;
  /**
   * `band === 'platform'` — shared runtime services/state consumed by many
   * features, built on foundation. Activates the `hasPrePlatformWork` barrier
   * (feature consumers wait so they bind to a real access contract instead of
   * hand-constructing). Distinct from `isFoundation`: foundation is pure
   * contracts (runs first); platform runs after foundation, before features.
   */
  isPlatform?: boolean;
  isFinal?: boolean;
  producesIntegrationGate?: boolean;
  consumesIntegrationGate?: boolean;
  expandedRagQuota?: boolean;
}

export interface TaskSchedulingHook {
  // ─── Consumer-side flags (this task type is BLOCKED by the named barrier) ───
  preIntegrationBarrier?: boolean;
  preTestgenBarrier?: boolean;
  preDocBarrier?: boolean;
  preUiBarrier?: boolean;

  // ─── Producer-side flags (running/queued tasks of this type ACTIVATE the named barrier) ───
  //
  // Static boolean flags below are uniform across a bundle's tasks. The
  // orchestrator iterates all running/queued tasks and asks each bundle
  // via these flags whether it should participate in a barrier's "work
  // pending" check — no `task.type === '...'` branches in the parallel layer.
  blocksUi?: boolean;
  blocksTestgen?: boolean;
  blocksDoc?: boolean;
  blocksIntegration?: boolean;

  // ─── Per-task classifier (band-driven flags) ─────────────
  //
  // Static boolean flags above are uniform across a bundle's tasks.
  // `classify` returns flags that depend on the task instance. The
  // input shape is `BaseTask` (the discriminated union); each bundle
  // narrows internally and reads only the discriminator it owns
  // (`task.band` for feature, `task.priority` for design-job doc, etc.).
  //
  // Phase-layer call sites pass the whole task; bundles do their own
  // narrowing — which keeps the bundle as the single source of truth
  // for "my band means scheduling role X".
  //
  // Retired predicates absorbed by classify (previously inline in
  // `parallel/TaskOrchestrator.ts`):
  //   - `isFoundationTask`        — feature.band === 'foundation' (was priority ∈ [200, 299])
  //   - `isTokensTask`            — setup type-fixed (was priority ∈ [100, 199])
  //   - `isTokensOrAssetsTask`    — isFoundation ∨ isTokens
  //   - `isPreIntegrationWork`    — producesIntegrationGate
  //   - `isFinalTask` (drain)     — verification type-fixed (was priority ≥ 1000)
  classify?(task: BaseTask): SchedulingClassification;
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

# Code Verification Task — Contract

> **Status**: SSOT for the code-job verification responsibility. Where this document diverges from the code, the code wins (code is truth); however, the **intended responsibilities/invariants/anti-patterns** declared here are enforced as guidance during refactoring/bug fixes.
> **Primary audience**: AI agents (for context injection when working on verification).

---

## 0. One-Line Definition

**Verification Task = the owner of "actually running verification (typecheck / build / test), and on failure: root-cause analysis → fan-out into one error sub-task per solution → re-enter the next cycle and re-verify"**.

The shortest invariant:

> **Verification cycle progress/termination is decided solely by the LLM's judgment from conversation history + 4 fail-safe terminals.** All auxiliary axes — deterministic gate cache / passed Set / repeated-plan hash / deep mode / install observation cache — are retired (vast-curling-perch RCA + the Aggressive simplification).

---

## 1. Scope + Owner Identification

### 1.1 Two kinds of owners

| Kind | Identification | Activation point | Notes |
|---|---|---|---|
| **Tier 3/4 dedicated verification task** | `isVerificationTask(task)` (priority 1000, type `'verification'`) | Verify-mode immediately on task fresh entry | Last in the queue (Final Verification) |
| **Tier 2 self-verify task** | `task.selfVerifyOnDone === true` (set at decompose; type is error/feature/ui/setup) | When the apply phase emits `<done>` (executeRouter.routeAfterDone === 'plan' branch) | Apply→verify two-cycle within a single task |

### 1.2 Unified predicate (SSOT)

```ts
// tasks/_shared/verify/predicate.ts
export function requiresVerification(task): boolean {
  if (!task) return false;
  if (isVerificationTask(task)) return true;
  return task.selfVerifyOnDone === true;
}
```

**Phase nodes/routers/composeBundle never reference the task type directly — they use only this predicate.** A natural extension of R1 (Task Type Blind Phases).

### 1.3 Phase mode channels

| Channel | Writer (single) | Meaning |
|---|---|---|
| `state._verifyEntered: boolean` | [`tasks/_shared/verify/markVerifyEntered.ts`](../../packages/ant-cli/src/agents/architect/graph/code/tasks/_shared/verify/markVerifyEntered.ts) | Whether the task has entered verify-mode |
| `task.batchSplitCount: number` | [`tasks/_shared/batchSplit/process.ts`](../../packages/ant-cli/src/agents/architect/graph/code/tasks/_shared/batchSplit/process.ts) Path A/B re-queue | Number of batch-splits in the verify cycle (carry-over via direct field assignment) |

When each channel is set:
- **Tier 3/4 verification task**: `markVerifyEntered(state)` is called automatically on handleFreshTaskEntry entry (verification tasks are unified onto the fresh path — verify-entry-unify).
- **Tier 2 self-verify**: `markVerifyEntered(state)` is called in the `executeRouter` `<done>` branch immediately after the `routeAfterDone === 'plan'` decision → verify-mode plan/execute is active from the next plan entry.

> The `state.verification: VerificationSession` channel is **retired**. Gate / passed / required / install cache / attempt counter / plan history are all replaced by the LLM's conversation history + the priorErrorTasks prompt injection.

---

## 2. Responsibility Matrix (4 items)

Each responsibility's **single SSOT location** + **consequence of violation**.

| # | Responsibility | SSOT | On violation |
|---|---|---|---|
| 1 | **Perform verification** — the LLM actually runs dependency install (if needed), typecheck (supported languages), build, and test via the `run_command` tool. For long-running commands (dev server / watchers) the tool result comes back as a verdict-free factual report ([19-tool-system.md §RUN_COMMAND](19-tool-system.md)), so the LLM reads `exit:` / `http_probe:` / framework error glyphs directly and judges | LLM (verify-mode plan tool-loop) — no runtime gate guard | Emitting done without running enables a false pass (LLM autonomy is trusted) |
| 2 | **Root-cause diagnosis + solution generation** — on failure, the plan tool-loop reads build/test output + error file contents, isolates the root cause, and emits planText (structured JSON) | LLM via verify-mode plan prompt ([`buildPlanPrompt`](../../packages/ant-cli/src/agents/architect/graph/code/tasks/_shared/verify/prompt/buildPlanPrompt.ts)) | LLM decides |
| 3 | **Batch-split (always-fan-out)** — fan out each solution target into a per-target error sub-task; the parent verification is re-queued (Path A) or a new final-verification is created (Path B) | [`tasks/_shared/batchSplit/process.ts::processDiagnosticBatchSplit`](../../packages/ant-cli/src/agents/architect/graph/code/tasks/_shared/batchSplit/process.ts) | For an n=0 implementation, the plan emits an empty plan + done → finalize decides |
| 4 | **Re-entry + re-verification** — after the error sub-tasks complete, the priority queue pops the verification again and re-runs it as a fresh entry | [`TaskOrchestrator`](../../packages/ant-cli/src/agents/architect/graph/code/parallel/TaskOrchestrator.ts) priority queue + handleFreshTaskEntry | If queue priority is violated, verification runs first and produces a false fail |

> The verification task itself never attempts fixes (responsibility polarization — after fan-out it immediately emits `done:true`).

---

## 3. Regression Guard SSOT (single axis)

```
Regression guard = LLM judgment from conversation history + explicit injects
├─ Banner (simplified)              — Prior batch-split cycles: N
├─ priorErrorTasks (prompt-injected) — all prior error sub-tasks {name, description}
└─ Fail-safe terminals (4)
   ├─ batch_cycle_limit          (MAX_BATCH_SPLIT_CYCLES=10) ★ verification only
   ├─ max_retries_exceeded        (state.retries — regular tasks)
   ├─ unresolved_violations       (regular tasks)
   └─ orchestrator_fail_limit     (task._failedAttempts ≥ MAX_TASK_RETRIES=2 — also applies to verification)
```

**Retired regression guards** (intentionally):
- `no_progress` terminal (based on planHistoryHashes) — vast-curling-perch RCA
- `missed_done_loop` terminal (`Session._attempts ≥ MISSED_DONE_TERMINAL`)
- `Safety Net C` (verify-only loop guard based on `_finalTaskLoopCount`)
- `Session.passed/required` gate cache + `commandGuard.guard` (already-passed / ordering) — replaced by LLM judgment + prompt rules
- `Session._installNeeded` install observation cache — replaced by the one-shot `state._installNeededTransient` prompt var
- `Session._attempts` deep-diagnostic mode + the isDeepDiagnostic prompt branch
- `hasOwnAttemptCounter` orchestrator hook (verification's own attempt counter) — unified into `_failedAttempts`

---

## 4. Lifecycle (post-Aggressive)

```
verification task fresh entry (cycle 1)
  ↓ handleFreshTaskEntry — markVerifyEntered
  ↓ recomputeInstallNeeded → state._installNeededTransient
  ↓ buildPlanPrompt (verify-mode)
    ↓ banner: "Prior batch-split cycles: N" (N=task.batchSplitCount)
    ↓ priorErrorTasks: state.completedTasksDetails.filter(error)
  ↓ LLM tool-loop (run_command typecheck/build/test, read_file, etc.)
  ↓ LLM emit planText with batches[]
  ↓ processDiagnosticBatchSplit
    ↓ Path A (verification parent): re-queue with task.batchSplitCount += 1
    ↓ spawn N error sub-tasks
  ↓ orchestrator dispatches error sub-tasks (priority < 1000)
  ↓ error sub-tasks complete → orchestrator pops verification again
verification task fresh entry (cycle 2+) — same path, banner shows N+1
  ↓ ... loop until LLM emits empty plan + done (success) OR
        batch_cycle_limit fires (failure)
```

**Self-verify Tier 2 task** lifecycle:
```
apply phase plan/execute (task-type-specific hooks)
  ↓ <done> emit
  ↓ executeRouter.routeAfterDone (verify-mode)
    ↓ markVerifyEntered + _nextPlanEntry='reverify'
  ↓ next plan node entry: handleReverifyEntry (thin function)
    ↓ NODE_EXECUTE clear + recomputeInstallNeeded (NODE_PLAN preserved)
  ↓ verify-mode plan/execute hooks active
  ↓ ... same verification loop as Tier 3/4
```

**Core simplifications (vast-curling-perch + Aggressive)**:
- The verification task's fresh / reverify branching was removed (everything goes through `handleFreshTaskEntry`)
- The first-verify-entry decision for self-verify Tier 2 was removed — the apply-phase plan conversation is preserved as part of the conversation history
- The VerificationSession class was retired — gate set / passed cache / attempts counter / install cache were all replaced by LLM judgment
- 11 files retired (Session.ts/snapshot.ts/initSession.ts/freshEntry.ts/sessionLifecycle.ts/sessionTrace.ts/orchestrator.ts/commandGuard.ts/toolHook.ts/checkEvaluate.ts/gates.ts)

---

## 5. Key Prompt Composition

Verify-mode plan prompt ([`verification/base.md`](../../packages/ant-cli/src/core/prompt/templates/jobs/code/nodes/plan/variants/verification/base.md)):

```handlebars
{{#if hasSessionSummary}}
## Verification Cycle Status
{{{sessionSummary}}}                       # "Prior batch-split cycles: N"
{{/if}}

{{#if priorErrorTasks}}
## Prior Error Sub-Tasks Completed
{{#each priorErrorTasks}}
- "{{name}}" — {{description}}
{{/each}}

**Principle**: A new plan that repeats the same root cause / file / fix
angle as one of the above tasks is a regression. Diagnose what made them
insufficient and approach from a different angle.
{{/if}}

{{#if dependencyStatus}}
## Dependency Observation
{{{dependencyStatus}}}                     # state._installNeededTransient
{{/if}}

## Protocol
... typecheck → build → test order
```

---

## 6. Code Locations (post-restructure)

```
tasks/_shared/verify/
  index.ts                   # barrel
  predicate.ts               # requiresVerification
  composeBundle.ts           # router-only verify-mode dispatch
  activeHooks.ts             # phase-mode plan-prompt + execute-hook resolver
  markVerifyEntered.ts       # _verifyEntered channel SSOT + clearForTaskBoundary
  emptyImpl.ts               # plan-empty shortcut helpers
  env/
    env.ts                   # detectTestFilesFromDisk + isTypeScriptProject + probeInstallStatus
  terminal/
    budget.ts                # 3-axis VerificationBudget (planRetries, orchestratorFails, batchSplits)
    errors.ts                # 4 VerificationTerminalKind values
  prompt/
    buildPlanPrompt.ts       # verify-mode plan prompt builder
    priorErrorTasks.ts       # prior-error-tasks helper (state.completedTasksDetails filter)
  hooks/
    executeHook.ts           # verify-mode execute config
    router.ts                # verify-mode routeAfterDone (empty-plan → checkTaskStatus, plan otherwise)

tasks/verification/
  index.ts                   # bundle wiring
  hooks/decompose.ts         # isExclusive
  hooks/conversations.ts     # convKey
  model/is.ts                # isVerificationTask predicate
```

---

## 7. References

- This document is the durable SSOT; the originating plan/RCA notes are kept locally and not shipped with the OSS tree.

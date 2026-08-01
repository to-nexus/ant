# Verification Scenario Harness

> **One-line summary**: a 3-layer test harness that lets us repeatedly verify — without running an LLM — that the code job's verification loop takes the correct branch across 9 failure situations.

## 1. Why it is needed

The code job's verification task runs the closed loop `plan → execute ↔ tool → checkTaskStatus → learn → plan` and chooses between **3 kinds** of branches inside it:

1. **In-task reverify** (`executeRouter` — back to plan after code fixes)
2. **error sub-task batch split** (`plan/processDiagnosticBatchSplit` — when there are many errors, decompose per file and requeue)
3. **enforce → retry after a violation** (`routeAfterCheckTaskStatus` — retry within the task)

A real code job is slow and non-deterministic, so branches like "force split fires on the 3rd repeated plan hash" or "only a `<done>` tag comes out while the tracker is empty, so verification_incomplete must surface" cannot be reproduced by hand. Only frozen scenarios that re-verify within a second keep regressions out.

## 2. The 3-layer pyramid

```
┌─ L4 full E2E              manual         smoke only ───┐
│  L3 real-LLM resume       semi-determin. nightly/opt   │
│  L2 LLM-mock resume       deterministic  main (runner) │
└─ L1 node units (vitest)   fully determin. CI gate      ┘
```

| Layer | Input control | LLM | Runtime | CI | Coverage target |
|---|---|---|---|---|---|
| **L1 unit** | hand-assembled fake state | none | ms | ✅ CI | pure branch functions |
| **L2 scenario** | seed session + commandInject + LLM mock | mock | seconds | opt-in | the whole verification loop |
| **L3 real LLM** | same, but with a real LLM | real | minutes | manual/nightly | regression check of L2 results |
| **L4 full E2E** | `e2e-runbook.md` | real | minutes+ | manual | user-experience smoke |

**This document focuses on L1 and L2.** L1 is included in the CI gate (`pnpm test:cli`), and all 10 L2 scenarios (S00~S09) are reproducible via `pnpm scenario [--list | Sxx | --all]` (see §8).

## 3. Glossary

| Term | Meaning | Implementation in this harness |
|---|---|---|
| Fault Injection | deliberately injecting failures | `ANT_COMMAND_INJECT` + `ANT_COMMAND_OVERLAY_MODE` |
| State Seeding | resuming from an intermediate state | freeze the just-before-verification state into `sessions/architect/code.json` |
| Scenario Matrix | failure type × branch strategy matrix | `scenarios/S01`..`S09` directories |
| Test Doubles | stand-ins for external dependencies | `MockLLMClient` (existing) + `commandInject` (new) |
| Hermetic | reproducible isolated environment | `.ant-test/scenario-runs/<runId>`, fresh on every run |

## 4. Coverage matrix (C1~C16)

Rows = branches/states of the verification logic, columns = layers.

| # | Code branch (file · line) | L1 unit | L2 scenario | ID |
|---|---|:---:|:---:|---|
| C1 | `isVerificationComplete` all combinations | ✅ | · | — |
| C2 | `routeAfterCheckTaskStatus` — violations=0 → learn | ✅ | ○ | S01, S06 |
| C3 | same — violations>0 + retries<max → enforce | ✅ | ○ | S08 |
| C4 | same — retries>=max → learn | ✅ | ○ | S09 |
| C5 | same — recursionRemaining<20 → learn | ✅ | · | — |
| C6 | `processDiagnosticBatchSplit` — batches>=2 branch | ✅ | ○ | S02 |
| C7 | same — forceByRepeat (`_lastPlanHash` repetition) | ✅ | ○ | S04 |
| C9 | same — overErrorBudget / overFileBudget | ✅ | · | — |
| C10 | `executeRouter` done + completeness.ok → checkTaskStatus | · | ○ | S01 |
| C11 | same — done but incomplete → plan(reverify) | · | ○ | S03 |
| C12 | `checkTaskStatus` — `<done>` + incomplete tracker → `verification_incomplete` | · | ○ | S08 |
| C13 | same — final verification auto-added on error task completion | · | ○ | S07 |
| C14 | `plan` node — tracker/budget initialized on verification entry | ✅ | ○ | S01..S09 |
| C15 | `plan` node — tracker attempted reset on verification retry | ✅ | ○ | S08 |
| C16 | `tool` node — typecheck/build/test command classification → tracker update | · | ○ | S01, S03, S06 |
| C17 | `codeCommandPolicy` — independent `*Passed` guard (cache preserved across retry/reverify boundary) | ✅ | ○ | S10 |
| C18 | `decideInvalidationScope` — manifest diff-aware scope (package.json field branching) | ✅ | ○ | S10 |
| C19 | `codeCommandPolicy` — 3-gate ordering (test allowed only after `buildPassed`) | ✅ | · | — |
| C20 | `runCommand` — dep-hash skip guard preserved even on retry entry (zero duplicate `npm install`) | ✅ | ○ | S11 (planned) |
| C21 | `checkTaskStatus` verification-block unification — graph.ts and workerGraph.ts go through the shared `evaluateVerificationCompletion` function | ✅ | · | — |

**Current status**: the L1 column (C1~C9) is fully auto-verified by `pnpm test:cli`.
For the L2 column, the schema + injection layers are in place; the runner + fixtures are follow-up.

## 5. Scenario matrix (L2 targets)

| ID | Name | Mode | Seeded situation | Injection | Expected path | Verifies |
|---|---|---|---|---|---|---|
| S01 | single-type-error-reverify | real | tracker incomplete, 1 verification in queue | none | plan → tool(tsc fail) → execute → router(reverify) → plan → tool(pass) → check → learn | C10, C14, C16 |
| S02 | multi-file-build-errors-split | overlay | tracker incomplete | fixed stderr with 2-file errors | plan(batches=2) → split → 2 error sub-tasks + original requeued | C6 |
| S03 | typecheck-plus-test-failure | real | tracker incomplete | none | complete after 2 consecutive reverifies | C11, C16 |
| S04 | repeated-plan-hash-force-split | overlay | `_lastPlanHash` pre-set | fixed tsc stderr | forceByRepeat → split | C7 |
| S06 | no-tests-no-typecheck | real | no tsconfig/tests | none | only build runs, completes immediately | C2, C14 |
| S07 | error-only-job-final-verification-autoadd | stub | a single error task only | commands skipped | final verification auto-added | C13 |
| S08 | done-but-incomplete | stub | — | LLM mock emits `<done>` immediately | verification_incomplete → enforce → retry | C3, C12, C15 |
| S09 | retries-exhausted-learn-exit | stub | `retries=3, maxRetries=3` | `<done>` + incomplete tracker | skips enforce, goes to learn | C4 |
| S10 | dep-manifest-surgical-invalidation | stub | tracker all passed | one-line devDep change `<file>` | after reverify, `ALREADY PASSED: tsc --noEmit` blocked (F1 × F2 combined) | C17, C18 |

## 6. S02 full walkthrough

### Directory
```
scenarios/S02-multi-file-build-errors-split/
├── scenario.json
├── feature/
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── a.ts   # const x: number = "str"
│       └── b.ts   # import { y } from './c'
├── session.seed.json
└── inject.json
```

### `session.seed.json`
```json
{
  "taskQueue": [
    { "id": "final-verification", "name": "Final Verification",
      "type": "verification", "priority": 1000, "status": "todo" }
  ],
  "currentTask": null,
  "completedTasks": [],
  "retries": 0,
  "maxRetries": 3,
  "_verificationBudget": 8,
  "_verificationTracker": null
}
```
→ on resume, the plan node pops it and initializes the tracker.

### `inject.json`
```json
{
  "rules": [
    { "pattern": "pnpm (run )?build|tsc",
      "exitCode": 1,
      "stderr": "src/a.ts(1,7): error TS2322...\nsrc/b.ts(1,10): error TS2307..." }
  ]
}
```

### `scenario.json`
```json
{
  "name": "multi-file-build-errors-split",
  "description": "Two-file build errors → plan returns batches=2 → split",
  "mode": "overlay",
  "expected": {
    "routeSequence": ["plan", "execute", "tool", "plan"],
    "taskQueueAfterSplit": [
      { "type": "error", "prePlanTextIncludes": "a.ts" },
      { "type": "error", "prePlanTextIncludes": "b.ts" },
      { "type": "verification", "_batchSplitCount": 1 }
    ],
    "flagSet": ["_batchSplitRequeued"]
  }
}
```

### Runner execution steps (future)
1. Copy `feature/` to `.ant-test/scenario-runs/S02-<ts>/.../features/S02/codebase/`.
2. Write `session.seed.json` to `features/S02/sessions/architect/code.json`.
3. Refresh the `latest` symlink.
4. Inject `env: { ANT_WORKSPACE_BASE_PATH, ANT_COMMAND_INJECT, ANT_COMMAND_OVERLAY_MODE=overlay, ANT_LLM_MOCK_RESPONSE_DIR }`.
5. Run `ant-cli resume-job --project verification --feature S02 --job code`.
6. After exit, reload `features/S02/sessions/architect/code.json`.
7. Compare against `expected` → diff report.
8. Keep/delete the directory per the `--keep=fail|all|none` policy.

## 7. Execution-mode guard (F10 resolution)

The `mode` field in `scenario.json` is mandatory. The runner checks these combinations:

| Check | Rule | Expected behavior |
|---|---|---|
| `mode=real` + `inject.json` exists | injection mixed into a real run | runner aborts (error) |
| `mode=stub` + fixture contains real errors | a stub could mask a real bug | runner warning |
| `mode=overlay` + no `inject.json` | nothing to overlay | runner warning |

## 8. Current implementation status

### 8.1 Landed (foundation PR `verification_scenario_harness_a1514eb3`)
- ✅ `/.ant-test/` added to `.gitignore`
- ✅ L1 unit tests (`tests/verification/unit/`) — 10 files, ~1069 total cases
- ✅ Test-only exports of `processDiagnosticBatchSplit`, `normalizePlanForHash`
  (`__testing__` namespace)
- ✅ Command Mock Layer (`src/utils/commandInject.ts`) + `runCommand.ts` integration (no impact on the production path)
- ✅ `ScenarioConfig` / `ScenarioSessionSeed` / `ScenarioCommandInjectFile` / `ScenarioRunResult` type schemas in `@ant/shared`
- ✅ This design document

### 8.2 Landed (runner PR `verification_scenario_followup_fb7bb611`)
- ✅ **CLI**: `pnpm --filter @ant/cli resume-job` (`src/cli/resume-job-cli.ts`) — bypasses HTTP `/resume`, calls `orchestrator({ agent:'architect', jobType:'code', ... })` directly
- ✅ **Execution trace**: `src/utils/verificationTrace.ts` + JSON-line append on entry to 6 nodes (plan/execute/tool/enforce/learn/checkTaskStatus). No-op when `ANT_VERIFICATION_TRACE_FILE` is unset
- ✅ **LLM mock response dir**: `MockLLMClient` returns `ANT_LLM_MOCK_RESPONSE_DIR/<nodeType>-<callIdx>.md` / `<nodeType>.md` preferentially (fallback: the existing hard-coded responses)
- ✅ **Runner library**: `tests/verification/scenarios/runner.ts` + `diff.ts`
  - fixture copying, session envelope wrapping, env injection, tsx child execution, trace parsing, `ScenarioExpectedOutcome` comparison
  - blocks `ANT_REDIS_URL`, forces `ANT_TASK_CONCURRENCY=1` (the parallel worker graph is out of this harness's scope)
- ✅ **CLI entry**: `pnpm scenario --list | Sxx | --all [--keep=fail|all|none] [--max-runs=N] [--real-llm] [-v]`
- ✅ **Smoke fixture `S00-runner-smoke`**: stub mode; proves the infrastructure works end to end. A minimal scenario confirming that plan/execute/checkTaskStatus/enforce entries land in the trace
- ✅ **Runner unit tests** (`tests/verification/scenarios/runner.test.ts`) — discovery + scenario.json validation + ID resolution, 8 cases

### 8.3 Landed (this PR `verification_scenario_fixtures_ac22c499`)

**Directory reorganization**:
- L1/L2 unified under one parent: `tests/verification/{unit,scenarios}/`

**B1~B4 infrastructure blockers resolved**:
1. **B1 — escape hatch for `retries` reset on resume**: `runCodeGraph` line 53 + `plan/index.ts` line ~517
   use the session's `retries` value as-is only when `ANT_SCENARIO_PRESERVE_RETRIES='1'`. The runner injects that env,
   so accumulated-retries scenarios like S09/S08 become reproducible. The production path (env unset) is unaffected.
2. **B1 extension — Axis E/F state restoration**: when `ANT_SCENARIO_PRESERVE_RETRIES='1'`, the `runCodeGraph` resume path
   restores `_verificationTracker` / `_verificationBudget` / `_lastPlanHash` / `_appliedPlanHistory` from the session.
   Fixtures can now freeze Axis E/F state directly.
3. **B2 — child exit policy**: `ScenarioConfig.expectedChildExitCode: 0 | 'nonzero' | 'any'`.
   The runner compares against the actual exit code to distinguish "intended throw" from "accidental crash".
4. **B3 — execute mock golden response**: `tests/verification/scenarios/fixtures/golden/execute-verification-done.md`
   (only `<done>`, no `<file>` tags → the `Session.isComplete()` check becomes the routing decider → determinism secured). Each scenario copies this file
   to `llm-mock/execute.md`. The `_executeModifiedFiles=false` shortcut used to decide routing in the past, but
   that channel was retired after the `urban-fronting-faith` postmortem.
5. **B4 — `appendTrace extra` logging**: `extra.flagSet` / `extra.violations` are additionally recorded at the
   `plan` node's `_batchSplitRequeued` branch, `checkTaskStatus`'s violations push,
   and `checkTaskStatus`'s Final Verification auto-add point.
   The diff engine can now evaluate volatile flags too.

**9 scenario fixtures**:

| ID | Mode | Trigger | Main assertion |
|---|---|---|---|
| S01 | stub | incomplete tracker | route plan→execute→check→enforce→plan, violation: verification_incomplete |
| S02 | overlay | 2-file tsc stderr — with always-fan-out, modify×2 auto-converts to per-target batches | flagSet `_batchSplitRequeued` |
| S03 | stub | both typecheck+test failing | same route, violation `verification_incomplete` |
| S04 | overlay | plan hash repetition (set plan1 → match plan2) — under the always-fan-out policy an identical plan fans out identically | flagSet `_batchSplitRequeued` |
| S06 | stub | tracker complete from the start | route plan→execute→check→learn |
| S07 | stub | one error task with prePlanText | flagSet `finalVerificationAutoAdded` |
| S08 | stub | tracker=null + golden done | violation `verification_incomplete` + enforce→plan |
| S09 | stub | `retries=3, maxRetries=3` | route check→learn (C4 — routeAfterCheckTaskStatus returns learn) |

**Per-scenario env overrides**: selectively inject `RECURSION_LIMIT` etc. via `ScenarioConfig.env` (allow-list based). After the always-fan-out refactoring, the verification split-threshold env vars (`ANT_VERIFICATION_SPLIT_ERRORS` / `ANT_VERIFICATION_SPLIT_FILES`) and the plan-history body limit (`ANT_PLAN_HISTORY_LIMIT`) were all retired.

**Shared golden response directory**: `tests/verification/scenarios/fixtures/golden/execute-verification-done.md`.

### 8.4 Landed (this PR `verification_cache_gap_fix_*`)

**3 root-cause blockers (FPOP Constraints)**:
- **F1** — independent `*Passed` runtime guard in `codeCommandPolicy.ts`. Even when
  `*Attempted` is reset at the retry/reverify boundary, `*Passed=true` deterministically blocks re-execution. The observable
  tracker state is promoted to SSOT instead of the prompt's stochastic hint (`cachedPassedSteps`).
- **F2** — diff-aware extension of `decideInvalidationScope`. A devDependencies-only change in `package.json`
  → `scope:'test'` + install; dependencies/scripts/exports changes → `scope:'all'` + install;
  lockfile (pnpm-lock.yaml/package-lock.json/…) → `scope:'build'` + install. Without a diff the
  existing conservative `scope:'all'` fallback is kept (backward compatible). The `editFile`/`createFile` call sites
  pass `{oldContent, newContent}`.
- **F4** — 3-gate ordering in `codeCommandPolicy.ts`. Test commands are allowed only when `buildPassed=true`.
  Bypass is allowed in deep-diagnostic mode. A "Verification Gate
  Ordering" principle section was added to the verification prompt `rules.md`.

**2 noise removals (Axis D policy consistency)**:
- **F3a** — consistent clearing of `state.violations` on retry/reverify entry. Right after `renderRetrySummary`
  compresses into normalizedErrors, the original violations are considered consumed. The same invariant applies on every re-entry path
  (verification retry / regular retry / reverify).
- **F3b** — `composeViolationsText` suppresses `verification_incomplete`-family violations when
  `retrySummaryText` exists. Removes contradictory signals that duplicate the summary's normalizedErrors.
  Mostly resolved naturally once F3a lands, but kept as defense in depth.

**Observability**:
- **F3c** — added `retentionMode: 'summary'|'full'|'none'`,
  `summaryInjected: boolean`, `summaryLen: number`, `passedGatesAtRetry: ('typecheck'|'build'|'test')[]`
  to `logVerificationRetry`. Resolves the problem where the hard-coded `preservedHistoryLength: 0` was misread as
  "raw history loss" (Axis D is a summary-retention policy in the first place).

**Regression protection**:
- L1: new `tests/verification/unit/codeCommandPolicy.test.ts` (5 F1 cases + 3 F4 cases + 1 execute-phase case).
  8 F2 diff-aware cases added to `tests/verification/unit/invalidationScope.test.ts`.
- L2: `S10-dep-manifest-surgical-invalidation` fixture added (stub mode; seeds the tracker as all passed
  and execute overwrites a one-line devDep via `<file>`).

### 8.5 Known compromises

- **S01/S03 use stub instead of real mode**: reproducing with `feature/` + real tsc/vitest would require a node_modules install per scenario,
  making fixture size/speed unrealistic. Instead the session seed freezes `_verificationTracker` into the desired state, hitting the same branches (C10/C11).
- **`S05.taskQueueAfterSplit` assertion deferred**: after the batch split, the graph keeps running and drains the queue, so only an empty queue remains in the final session.
  Indirectly verified via `extra.batchCount`/`splitCount` in the trace, but a session-based assertion is unimplemented. If needed, a "halt immediately when split occurs" hook can be added to the runner.
- **The parallel worker graph (`workerGraph.ts`) still has no trace hooks** — the runner forces `ANT_TASK_CONCURRENCY=1` to bypass this.

## 9. Troubleshooting

| Symptom | Cause | Resolution |
|---|---|---|
| The seed session file disappears right after resume | `saveCheckpoint` overwrites it | Have the runner watch the session between seed → spawn, or mock `deps.session` |
| inject rules have no effect | `ANT_COMMAND_OVERLAY_MODE` unset | Both env vars must be set to activate (gating policy) |
| force split does not fire in the `processDiagnosticBatchSplit` test | `modify.length === 1` | There must be 2+ split targets to pass the `batches.length > 1` condition |
| LLM mock response format mismatch | execute prompt tags (`<file>`, `<done>`) missing | Capture a real mock-server response once and save it as the fixture |
| Runner won't run without a Redis connection | `.cursorrules`: Redis is always required | Bring up Redis via `pnpm dev:infra`, or run L1 units only |

## 10. Scope boundary

| Area | Covered? | Where? |
|---|---|---|
| verification-task internal loop branch regressions | ✅ | this document (L1 + L2) |
| real-LLM judgment quality | ❌ | L3 or a separate eval dataset |
| prompt template snapshots | ❌ | `prompt-test-spec.md` |
| full HTTP→queue→worker smoke | ❌ | `e2e-runbook.md` |
| the path where decompose creates verification (F11) | ❌ | delegated to L4 E2E |
| state races under parallel task execution | ❌ | separate plan |
| cloud-mode permissions/paths | ❌ | staging-environment validation |

---

## 11. Deploy recovery verification scenarios (manual)

A manual procedure verifying the Preview Deploy service's lazy re-hydration + per-feature state isolation. See [22-preview-system.md#deploy-static-build-serving](../internals/22-preview-system.md).

### D1. Cross-feature log/state isolation (bug 1 regression)

**Precondition**: a project with at least 2 features (F1, F2) ready.

1. Select F1 → click the Deploy button → enters `phase=building`, build logs start accumulating in the console
2. While the build is in progress (before `running`), switch to F2
3. **Expected**: F2's console must be empty and F2's state must be `idle` or F2's own past state (F1's `building` must not show)
4. Return to F1
5. **Expected**: F1's build logs + current phase are restored intact

Verification points: key separation in the `deployByFeature` slice; on SSEManager reconnect, the EventSource URL is per-feature.

### D2. Pod restart recovery

**Precondition**: a deploy in `phase=running` on F1.

1. `kubectl rollout restart deployment/ant-preview` (cloud) or kill the `ant-preview` process locally
2. Observe the UI after restart completes — `cleanupStaleDeploys()` transitions the previous pod's `running` entries to `hibernated` + SSE broadcast
3. **Expected**: the UI's phase updates to `hibernated`, a "Wake up" button appears
4. Refresh the deploy URL (`/deploy/{urlKey}/...`) in the browser, or click "Wake up"
5. **Expected**: `phase=starting` SSE received → within seconds `phase=running` + the page renders normally

Verification point: `ensureRunning()` reads `.deploy/meta.json` and restarts the static server.

### D3. Idle eviction

1. Start ant-preview with `ANT_DEPLOY_IDLE_TTL_MS=60000` (60 seconds)
2. After a successful deploy, leave the URL untouched for over a minute
3. **Expected**: `startIdleEviction()` cleans up the process + broadcasts `phase=hibernated`
4. Click the URL
5. **Expected**: the same `starting → running` transition as D2, then render

### D4. Unavailable (lost artifacts)

1. Get F1 to the `running` state
2. Kill the static server process + delete `workspacePath/.deploy/meta.json` + delete `buildOutputDir`
3. Access the URL
4. **Expected**: the proxy transitions to `phase=unavailable` + SSE broadcast, 404 response. The UI shows an "artifacts missing" badge + a "Redeploy" button

### D5. Stale correction on tab focus

1. Get `running` on F1, move the tab to the background
2. Trigger a pod restart from another tab (or kill the static server)
3. Return to the F1 tab (`visibilitychange` event fires)
4. **Expected**: `useDeployManager` re-calls `getDeployStatus`, and the UI immediately corrects to the latest state such as `hibernated`

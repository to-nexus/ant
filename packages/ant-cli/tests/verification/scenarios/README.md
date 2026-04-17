# Verification Scenario Harness — Fixture Source

This directory is the **source of truth** for L2 scenario fixtures. Runtime
execution happens under `ant/.ant-test/scenario-runs/<runId>/` (gitignored) so
every scenario starts from a clean workspace.

See the full design in [`docs/testing/verification-scenarios.md`](../../../../../docs/testing/verification-scenarios.md).

## Directory layout

```
tests/verification/
├── unit/               ← L1 pure-function unit tests (vitest)
└── scenarios/          ← L2 harness
    ├── README.md       ← you are here
    ├── runner.ts       ← library invoked by `pnpm scenario`
    ├── runner.test.ts  ← discovery / validation smoke tests
    ├── diff.ts         ← expected-outcome evaluator
    ├── fixtures/       ← shared golden responses (e.g. execute stream)
    └── scenarios/      ← one directory per fixture
        └── Sxx-<name>/
            ├── scenario.json    (ScenarioConfig, see @ant/shared/verification-scenario)
            ├── session.seed.json (ScenarioSessionSeed — verification task already in queue)
            ├── inject.json      (ScenarioCommandInjectFile — used for overlay/stub modes)
            ├── feature/         (fixture codebase copied into runtime workspace)
            └── llm-mock/        (optional — fixed LLM responses for execute/plan nodes)
```

## Current status

- **L1 unit tests**: implemented under `tests/verification/` and run as part
  of `pnpm test:cli`. They cover the pure branch logic that feeds into the
  verification loop:
  - `isVerificationComplete.test.ts` — SSOT completion judgement
  - `routeAfterCheckTaskStatus.test.ts` — 3-axis branch (violations / recursion / retries)
  - `processDiagnosticBatchSplit.test.ts` — force-split triggers (C6–C9)
  - `commandInject.test.ts` — fault-injection utility
- **Command injection layer**: `src/utils/commandInject.ts` + `runCommand.ts`
  wiring. Inactive unless both `ANT_COMMAND_INJECT` and `ANT_COMMAND_OVERLAY_MODE`
  are set — production is unaffected.
- **Execution trace**: `src/utils/verificationTrace.ts` appends node-entry JSON
  lines to `$ANT_VERIFICATION_TRACE_FILE`. No-op when env unset.
- **LLM mock response dir**: `MockLLMClient` reads
  `$ANT_LLM_MOCK_RESPONSE_DIR/<nodeType>-<callIdx>.md` → `<nodeType>.md` →
  falls back to the hardcoded mock response.
- **Scenario type schema**: `packages/ant-shared/src/verification-scenario.ts`.
- **L2 runner**: `pnpm --filter @ant/cli scenario [id|--list|--all]`.
  Spawns `pnpm --filter @ant/cli resume-job` as an isolated child, seeds the
  session file, drives commands via overlay/stub injection, and diffs against
  `ScenarioExpectedOutcome`.
- **Runner smoke tests**: `runner.test.ts` (8 cases) cover discovery + config
  validation + id resolution. These run as part of `pnpm test:cli`.
- **Fixtures**: `S00-runner-smoke` + `S01..S09` — ten scenarios covering
  C1–C16 branches (`pnpm scenario --all`). See
  [`docs/testing/verification-scenarios.md`](../../../../../docs/testing/verification-scenarios.md) §8.3
  for the final matrix and per-scenario trigger notes.

## Adding a new fixture

1. Pick the next free `Sxx` identifier.
2. Create `scenarios/Sxx-<name>/`.
3. Write `scenario.json` validating against `ScenarioConfig`
   (see `packages/ant-shared/src/verification-scenario.ts`).
4. Seed `session.seed.json` — always `currentTask: null`, verification task
   in the queue with `status: 'todo'`.
5. Pick a mode (`real | overlay | stub`) following the guard rails in the doc.
6. Run `pnpm scenario Sxx` and iterate on `expected.routeSequence` until green.

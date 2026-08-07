# Testing

## Test system

| Kind | Command | Infrastructure | Purpose |
|------|------|--------|------|
| Unit/Snapshot | `pnpm test:cli` | None | Regression protection for prompts / RAC / utils (CI gate) |
| Verification Scenarios | `pnpm --filter @ant/cli scenario [id\|--all]` | LLM mock (process-internal) | verification-loop branch regressions |
| E2E Mock | `pnpm test:e2e` | mock server required | Automated verification of the full HTTP → queue → worker path |
| E2E Real | curl (manual) | server + LLM API key | Full pipeline including a real LLM |

Reference documents:
- `prompt-test-spec.md` — Unit/Snapshot test spec (prompt-only)
- `verification-scenarios.md` — code job verification-loop branch regression harness (L1 + L2)
- `e2e-runbook.md` — E2E Real manual procedure
- `e2e-intent-reference.md` — per-intent curl reference

## Quick start

```bash
# 1. Unit tests (day-to-day, this is all you need)
pnpm test:cli                # ~580 files, ~6,700 tests, ~30s, no infrastructure needed

# 1b. Verification scenarios (L2 regressions)
pnpm --filter @ant/cli scenario --all    # 10 scenarios, mock LLM, no Redis needed
pnpm --filter @ant/cli scenario S08      # single scenario
pnpm --filter @ant/cli scenario --list   # metadata-only JSON output

# 2. E2E mock tests (after starting the servers)
pnpm dev:infra               # Redis + ChromaDB
pnpm dev:mock                # 4 CLI processes + LLM mock
pnpm test:e2e                # run in a separate terminal

# 3. Build (does not run tests)
pnpm build                   # esbuild only
```

## CI gate

**The build does not run tests.** There is no `prebuild` hook and none should be
added — `packages/ant-cli/Dockerfile` builds via `pnpm build:cli`, so charging
every image build the full suite is a deliberate non-goal.

The only gate is CI ([.github/workflows/ci.yml](../../.github/workflows/ci.yml)),
which runs `typecheck:cli` · `typecheck:ui` · `typecheck:tests` · `test:cli` ·
`@ant/ui test` plus the `oss-guard` and `boot-smoke` jobs. `vitest.config.ts`
includes `tests/**/*.test.ts`, so adding a `.test.ts` under that path
automatically joins the CI gate.

```
CI: test:cli FAIL → PR merge blocked
```

## Definition of green

- `pnpm test:cli` PASSES (~30s)
- `pnpm test:e2e` PASSES (with the mock server running)

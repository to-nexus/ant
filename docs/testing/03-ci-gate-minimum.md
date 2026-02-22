# CI gate (minimum, survivable)

The goal of a CI gate is not “high quality in theory”.  
It is: **prevent merges that break the 3 core flows**.

## What the gate must contain (minimum)

- **Build + typecheck** (fast signal)
- **Prompt safety gate** (`npm test` in ant-cli — runs in ~1s, no infra needed)
- **Core smoke suite** (`docs/testing/01-core-smoke-suite.md`)

If you only gate on build/typecheck, you will still ship broken Redis/SSE/Preview flows.

## What the gate must NOT contain (yet)

- Big unit test suite with lots of mocks.
- Browser UI E2E for everything.

Those are expensive and often flaky early; they slow you down without removing your main fear (core flow regressions).

## Flaky test rule (non-negotiable)

If a smoke test is flaky:

- **Stop adding more tests.**
- Fix the flake first by making waits deterministic:
  - wait on **job status transitions** (`/api/jobs/:jobId/status`)
  - or wait on **SSE events**
  - do **not** add random sleeps

If you accept flakes, your brain will ignore red builds, and the gate dies.

## Proposed PR policy (simple)

- Merge is allowed only if:
  - build/typecheck pass
  - smoke suite passes

## Practical note for Ant (service topology)

Smoke tests are black-box and assume these services are running:

- API server (4100)
- Realtime SSE server (4101)
- Worker
- Preview server (4102)
- Redis


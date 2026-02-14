# Testing (practical)

This folder exists for one purpose: **ship changes without fear** by locking Ant’s **3 core flows**:

- **Chat → job enqueue/run → SSE streaming visible**
- **Preview lifecycle works end-to-end**
- **Resume/continue (revise) works end-to-end**

If you only do one thing from this folder, do the smoke suite in `01-core-smoke-suite.md`.

## What these words mean (non-textbook)

- **E2E**: “From the outside, does the whole flow work?”  
  For Ant that means: HTTP → Redis/BullMQ → worker → Redis Pub/Sub → SSE → client.
- **CI gate**: “A merge is blocked unless the smoke suite passes.”  
  Without this, your brain becomes the CI (manual clicking/log hunting).
- **Observability (관측성)**: “When it fails, can you tell *where* and *why* in minutes?”  
  Minimum = correlation id + a few key logs you can trust. Not full APM.

## Definition of green

You are “green” when:

- You can run the smoke suite locally and get **PASS/FAIL** within ~10 minutes.
- When it fails, you can pinpoint whether the failure is **API / Realtime(SSE) / Worker(queue) / Preview** without guessing.

## Non-goals (not now)

- Chasing broad unit test coverage.
- Browser automation for everything.
- “Perfect” test architecture.

## Documents

- `01-core-smoke-suite.md`: the actual smoke tests (3–5) with concrete pass/fail signals.
- `02-local-runbook.md`: exact local commands + minimum env for repeatable runs.
- `03-ci-gate-minimum.md`: the minimum PR gate and how to treat flaky tests.
- `04-backlog.md`: only what unlocks speed later.


# Testing backlog (only items that unlock speed)

This backlog is intentionally short. If it doesn’t directly increase shipping speed, it’s not listed.

## 1) SSE message envelope contract test (tiny)

Goal: detect accidental breaking changes in SSE message routing without full UI tests.

- Lock the presence of initial states on unified SSE:
  - `kanban`, `chat`, `fileTree`
- Lock that workflow SSE can return an initial state or emits at least one update.

## 2) Preview regression test for proxy routing

Goal: keep preview “reachable”.

Minimum to lock:
- `POST http://localhost:4102/projects/:id/start`
- `GET http://localhost:4102/projects/:id/status`
- If status returns a `url` like `/<urlKey>`, then `GET http://localhost:4102/<urlKey>/` returns 200 (or at least not 404).

## 3) Resume stale-interruption guard regression

There is logic to skip stale interruptions when taskQueue is empty but completedTasks exist (see `job.routes.ts`).

Lock it with a regression test:
- Seed a session file with:
  - `interruption` present
  - `taskQueue.length === 0`
  - `completedTasks.length > 0`
- Call resume and assert it returns 404 “No interrupted job found” (because there is nothing to resume).

## 4) Add a single “daily internal flow” suite (later)

Once core smoke is stable, add 1 more suite that matches how your internal users actually work:

- “open feature → chat → job runs → preview opens → continue directive → resume after stop”

Keep it to **one** end-to-end journey.


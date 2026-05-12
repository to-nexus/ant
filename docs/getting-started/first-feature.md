# Your first feature: PRD → Design → Code

This walkthrough shows the spec-driven workflow end-to-end. You'll write a
PRD, generate a system design from it, and ship code that satisfies the
design. Estimated time: 20 minutes.

## Setup

Make sure you have completed the [local-mode install](../local-mode/install.md)
and have `pnpm dev:all` running.

Open the UI, create a new project (`domain: service`) and a new feature.

## Step 1 — Write the PRD

Send a directive that asks the **planner** agent to draft a PRD:

```
Plan a TODO web app. Users can sign up, create lists, share with collaborators.
Tasks have due dates, tags, and a priority. Mobile-first. No native apps.
```

The planner writes a Markdown PRD into `plan/prd.md`. You can:

- Read it in the artifacts panel.
- Send a follow-up directive like *"Add an offline-first requirement"* and
  the planner will revise the PRD.

Why bother? Because the next two stages **read the PRD as binding context**.
A weak PRD produces vague code; a clear PRD produces verifiable code.

## Step 2 — Generate the system design

Once the PRD is clean, ask the architect to design the system:

```
Design the system for the TODO app PRD. Pick a stack and document the
component layout, data model, and API contract.
```

This runs the `architect.design` job. It generates:

- `architecture/system/fe-system-main.md` — frontend system design
- `architecture/system/be-system-main.md` — backend system design (when
  applicable)
- `architecture/spec/api-contract-main.md` — API contract
- Spec files for individual flows in `architecture/spec/`

The design step produces **stable artifacts** that the code job will respect
as immutable. If you want a change later, ask the architect to update the
design before the code job — don't ask the code job to override it.

## Step 3 — Write code

Now ask for code:

```
Implement the TODO app per the system design.
```

Internally Ant:

1. **Detects** which design / spec / source artifacts are relevant
   (Resolved Action Context).
2. Picks the **execution tier** based on the request shape. A full-app
   build like this is typically Tier 3 (Task) or Tier 4 (RefsGrounded).
3. **Decomposes** into tasks: foundation feature → integration feature →
   verification.
4. **Plans + executes** each task, with file writes streamed live.
5. Runs **verification** at the end (typecheck, build, smoke tests).

Read the kanban for the task graph; read the preview pane for the running
app.

## Step 4 — Iterate

Once the app is up, iterate with smaller directives:

```
Add tag filters to the list view.
Persist user preferences in localStorage.
Show a 404 page for unknown routes.
```

Each becomes its own job. Smaller scopes hit lower tiers and finish in
seconds; larger scopes decompose and verify themselves.

Useful follow-ups:

- `Review the code.` — runs `rev-code`, which produces a review report
  without writing code.
- `Explain how the share flow works.` — runs `explain-code`, returning a
  chat-only walkthrough.
- `Run the tests and fix anything broken.` — typically lands as a
  verification → error task chain.

## What did you actually use?

| Phase            | Agent     | Job        | Read more |
|------------------|-----------|------------|-----------|
| PRD drafting     | planner   | `plan`     | [concepts/agents.md](../concepts/agents.md) |
| System design    | architect | `design`   | [concepts/jobs.md](../concepts/jobs.md) |
| Code generation  | architect | `code`     | [concepts/jobs.md](../concepts/jobs.md) |
| Verification     | architect | `code` (verification task) | [concepts/execution-tiers.md](../concepts/execution-tiers.md) |
| Code review      | architect | `code` (rev-code intent)   | [concepts/jobs.md](../concepts/jobs.md) |

## Tips

- **Be specific in PRDs.** "Build a dashboard" produces a generic dashboard;
  "Build a dashboard for finance ops with three KPI cards (MRR, ARR, churn)
  and a 90-day chart" produces a usable dashboard.
- **Don't fight the design step.** If the design doesn't match what you
  imagined, edit the PRD first, regenerate the design, then code. Skipping
  this loop is the most common cause of churn.
- **Use tags in directives.** `code refactor:` or `code error:` hint the
  triage; full intent docs are in
  [concepts/jobs.md](../concepts/jobs.md).

## Next

- [Concepts: spec-driven](../concepts/spec-driven.md) — why this loop is
  the whole point of Ant.
- [Guides: design input](../guides/design-input/) — bring Figma or Claude
  artifacts.
- [Guides: custom prompts](../guides/custom-prompts.md) — tune the agents
  for your codebase.

# Spec-driven engineering

This document is the manifesto. It explains why Ant rejects "vibe coding"
as a first-class workflow and what we do instead.

## The vibe-coding loop

Most AI coding tools are built around the same loop:

```
prompt → code → "no, like this" → code' → "still wrong" → code'' → ...
```

The user holds the spec in their head. The agent guesses at it from the
last message. There is no shared artifact that says "here is what we agreed
to build". Bugs are reported as feelings ("the layout looks weird") rather
than violations ("the gap should be 16px per design system token
`spacing.4`").

This works for prototypes, demos, and toy projects. It does not work for
real engineering. It produces:

- **Drift between iterations.** The agent forgets what it did three turns
  ago. So do you.
- **No verification.** "Did the change break anything?" requires running
  the code and seeing what happens. There is no contract to test against.
- **Implicit knowledge bottlenecks.** The only person who knows what should
  exist is the one prompting. Adding a second engineer to the loop means
  re-explaining everything.

If you have ever tried to ship a meaningful feature with a vibe-coding
tool, you have felt this. It hits a wall around 2,000 lines of generated
code, and the wall is structural — more prompting won't break through it.

## What spec-driven looks like

Ant's loop is:

```
PRD                  ← planner agent helps you write it
 │
 ▼
System Design        ← architect.design generates from the PRD
 │
 ▼
Code                 ← architect.code implements per the design
 │
 ▼
Verification         ← architect verifies code against the design
 │
 ▼  (loop on changes)
```

The spec is **explicit, persistent, and inspectable**. Every job reads its
upstream artifacts as binding context. When the code job is done, the
verification step proves that the result matches the spec. When you change
something, you don't lose what was already agreed; you just regenerate the
delta.

Concretely:

- The PRD lives in `plan/prd.md` and is regenerable. Editing it triggers
  rippled changes in design and code.
- The system design lives in `architecture/system/*.md` plus the API
  contract in `architecture/spec/`. These are the *immutable contracts* the
  code job must respect.
- The code lives in `codebase/`. Changes are made by feature tasks and
  proven by verification tasks.
- Each step's output is the next step's input. Removing a step breaks the
  chain — you would lose the verifiability.

## What this gives you

| Symptom of vibe coding                                            | What spec-driven does instead                                                  |
|-------------------------------------------------------------------|--------------------------------------------------------------------------------|
| "I forgot what we built three turns ago."                          | The PRD and system design are durable artifacts. Re-read them.                 |
| "Adding a second person to the loop is hard."                      | They read the same artifacts you wrote.                                        |
| "I can't tell if the change broke anything."                       | Verification tasks run typecheck/build/tests against the spec.                 |
| "The agent keeps re-introducing fixed bugs."                       | Verification gates flag regressions before they ship.                          |
| "Refactors are scary because the agent forgets the old behaviour." | The system design is unchanged across refactors; only the implementation moves.|
| "Generating tokens or design system primitives is unreliable."     | Design tokens are an explicit `design-system` task type with its own prompt.   |

## When *not* to use spec-driven

It would be dishonest to pretend the spec-driven loop is always the right
choice.

- **Throwaway prototypes**: if you'll discard the result tomorrow, the PRD
  step is overhead. Write a one-shot directive at Tier 1 (OneShot) and ship
  it.
- **Tiny diffs**: changing a button colour doesn't need a PRD. Ant
  auto-routes these to lower tiers (Reflex / OneShot / Exploratory).
- **Pure exploration**: when you don't know what you want yet, vibe coding
  is faster. Treat the result as scaffolding; rewrite into a spec when you
  start to care.

The 5-tier execution model picks the right level of formality
automatically. Spec-driven is the *upper* end of the spectrum, not the
*only* end. See [execution-tiers](execution-tiers.md) for the full matrix.

## How Ant enforces the spec

Three mechanisms:

1. **Resolved Action Context (RAC)** — every job is built from an explicit
   set of `refs` (authoritative inputs) and `context` (binding background).
   These are surfaced to the LLM as named slots, not glob-walked from disk.
   You cannot "accidentally" widen scope.
2. **Verification tasks** — Tier 3+ jobs include at least one `verification`
   task that re-reads the spec and runs gates (typecheck, build, smoke).
   Failed gates produce `error` tasks that fix the violation, then re-verify.
3. **State machine, not free-form orchestration** — every agent runs as a
   LangGraph StateGraph. The phases (resolve, triage, decompose, plan,
   execute, check, learn) are explicit. Each phase's prompt is constrained
   to its role.

If a job lands without producing the right artifacts, it fails. That is the
whole point.

## Read next

- [**agents**](agents.md) — who runs each phase.
- [**jobs**](jobs.md) — what each phase produces.
- [**execution-tiers**](execution-tiers.md) — when to be formal, when to be
  fast.
- [internals/14-code-job.md](../internals/14-code-job.md) — the deep dive
  into the code job's state machine.

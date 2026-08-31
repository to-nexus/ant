# Pipelines — custom jobs on a schedule

> ⚠️ **Experimental.** Cron triggers, linear chains, approval gates, and clarify
> gates ship and are covered by tests. Not there yet: webhook and event
> triggers, Slack/email delivery, per-step retry, `{{steps.*}}` substitution
> between steps, and parallel branches. Pipelines run on **workspace** projects
> only — the Codespace toggle in the UI is reserved, not wired. Every reserved
> knob is rejected loudly by the validator rather than silently ignored, so a
> definition never quietly does nothing.

The [universal runtime](custom-agents.md) runs one turn when a human presses one
button. A **pipeline** makes it self-driving: a duty that happens every Monday
shouldn't need someone to remember Monday.

This page is the user-facing model. The runtime contract, storage invariants, and
the reasoning behind each of them are in
[internals/46-pipeline-scheduling.md](../internals/46-pipeline-scheduling.md).

## Vocabulary

| Term | What it is |
|---|---|
| **Pipeline** | One definition: a cron trigger plus an ordered list of steps. A file. |
| **Step** | One DAG node — either a custom job to dispatch, or an approval gate that dispatches nothing. |
| **Run** | One firing of a pipeline. Has its own id, its own history, and a frozen copy of the definition. |
| **Activation** | The binding of a pipeline to one project. This — not the definition — is the scheduling unit. |

## A definition

```yaml
version: 2
name: Weekly ops report
on:
  schedule:
    cron: "0 9 * * 1"                    # 5 fields: minute hour day month weekday
    tz: Asia/Seoul                       # IANA zone; default UTC
    onMissed: skip                       # or runOnce, if the worker was down
    overlap: skip                        # or queue, if the previous run is still going
steps:
  - id: draft
    customJobRef: ops-team/weekly-report # {agentId}/{jobId} — chaining is cross-agent
    intent: report                       # 0..1, pinned here; never classified at runtime
    directive: "Draft last week's report. Run date: {{trigger.fireDate}}."
    context: [reports/template.md]       # optional @ctx pins, existence-checked at dispatch
  - id: sign-off
    type: approval
    prompt: "Publish the weekly report?"
    timeout: { after: 24h, onTimeout: reject }
  - id: publish
    customJobRef: ops-team/weekly-report
    directive: "Publish the approved report."
    on: success
```

Three template variables are available in `directive`: `{{trigger.fireDate}}`,
`{{trigger.fireEpoch}}`, `{{run.id}}`.

You don't have to write this by hand: the Pipelines tab's canvas edits the same
shape, and the **`pipeline-builder`** builtin agent composes one from a
description ("run ops-team's report every Monday 9am, gate publishing on my
approval"), reading the agents' catalogs so every step names a job and intent
that exist. Whatever authors it, the result is a disabled draft — enabling and
activating stay yours.

## Chaining

A step with no `needs` depends on the **previous step in file order**, so the
common case needs no wiring. `needs: []` makes a step a root; `needs: [a, b]`
waits for both.

`on` decides whether a ready step actually runs: `success` (the default),
`failure`, or `always`. A step whose condition doesn't match is **skipped**, and
skips cascade — a skipped dependency is neither a success nor a failure, so
nothing downstream of it fires by accident.

On the first failure, `defaults.onStepFailure` decides the run's fate:
`abort` (the default) cancels what is still pending and seals the run `failed`;
`continue` lets independent branches finish and seals `partial`.

A run executes the definition **as it was when the run started**. Editing the
YAML never mutates a run already in flight.

## Two ways a run stops for a human

This is what makes a pipeline different from a cron entry that shells out.

**An approval gate** is a step that issues no job. It waits — on a chat card, in
the Pipelines tab's approvals inbox, or until its `timeout` arm fires and decides
for you. All three routes land in one place, so a gate can be resolved once and
only once, and the decision is recorded with who made it, when, and through which
channel.

**A clarify question** is not a step at all — it is a *job* discovering
mid-flight that it needs to ask you something. The step parks, the run waits with
no deadline, and answering it resumes exactly where it stopped. A job can ask
more than once.

Neither kind of wait holds a worker. A gate can sit for a week at no cost.

## Definition vs activation

The distinction that carries the whole model:

- A **definition** is a project-free template. It lives in your account (or your
  organization), and by itself it never runs.
- An **activation** binds one pipeline to one project, and it lives in the
  account of whoever activated it. It records which scope the definition came
  from, so a later same-named definition somewhere nearer can't hijack a running
  schedule.

So one pipeline can be activated onto many projects at once, each keeping its own
run history — and one project holds at most one activation. Deactivating removes
the binding but **keeps the runs**: history belongs to the person who activated
it, and so does the billing.

### Availability — the state machine that keeps this honest

A definition carries an `enabled` / `disabled` state, and it gates
*activatability*, not execution:

| To do this | The definition must be |
|---|---|
| edit, delete, or promote it | **disabled** |
| activate it on a project | **enabled** |
| disable it | held by **zero** activations |

Disabling is never cascaded — not even by an organization admin. If someone else
still holds an activation, the request is refused and tells you who. The
consequence is worth stating plainly: **an activated definition cannot change.**
Nobody can edit the pipeline out from under a live schedule.

## An active pipeline owns its project

While a project has an activation, interactive jobs on that project are refused.
That is deliberate and total: an unattended run must not be superseded by a
person, or made to wait behind one. Deactivate first if you want the project
back.

## Sharing with an organization

Definitions follow the same scope model as [custom
agents](custom-agents.md#where-definitions-live-scopes): yours by default,
promotable into a team organization where an ACL names the owner plus any
delegated editors. Org members see the definition and each other's activation
rows (read-only — only the activator can deactivate their own).

Two consequences to plan for:

- **Billing and identity follow the activator**, re-checked at every step. If
  their account standing changes mid-chain, the next step fails rather than
  running on stale authority.
- **MCP credentials stay per-user.** Sharing a pipeline does not share its
  secrets; each member registers the keys their agents reference.

## Where a run's output lands

Every step is a normal universal job, so its session and artifacts land in the
bound project's `universal/artifacts/` tree exactly as an interactive run would.
Each step also appears in the workspace chat as a first-class turn, badged as
pipeline work, with a notice when the run starts and when it settles.

The run log itself is grafted read-only into the artifacts tree under
`pipeline-runs/`, so you can read a past run's history without leaving the
explorer.

## Read next

- [**custom-agents**](custom-agents.md) — the agent and job definitions a step
  actually runs.
- [**spaces**](spaces.md) — why pipelines are a workspace concept.
- [internals/46-pipeline-scheduling.md](../internals/46-pipeline-scheduling.md)
  — the runtime contract: trigger engine, dispatch ownership, the resolve
  funnel, failure and audit semantics, and the phase backlog.

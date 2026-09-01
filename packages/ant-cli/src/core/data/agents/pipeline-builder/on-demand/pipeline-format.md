# Pipeline definition contract

A pipeline is ONE definition object: a cron trigger plus a chain of steps.
This is every field the validator accepts and every rule it enforces. The
definition rides the save routes as the JSON value of `def`; it is shown here
as YAML for readability — the two shapes are the same object.

## A complete definition

```yaml
version: 2                      # required, exactly 2
name: Weekly ops report         # required, at most 100 characters
on:
  schedule:                     # the only trigger kind
    cron: '0 9 * * 1'           # 5 fields: minute hour day month weekday
    tz: Asia/Seoul              # IANA timezone; omitted = UTC
    onMissed: skip              # skip (default) | runOnce
    overlap: skip               # skip (default) | queue
defaults:
  onStepFailure: abort          # abort (default) | continue
steps:
  - id: draft                   # [a-z0-9][a-z0-9-]*, unique in the pipeline
    customJobRef: ops-team/weekly-report
    intent: report              # at most one; must exist in that job's catalog
    directive: >-
      Draft the operations report for the week ending {{trigger.fireDate}}.
    context:
      - reports/latest-metrics.md
  - id: sign-off
    type: approval              # a gate — dispatches no job
    prompt: >-
      The weekly report is drafted. Publish it and file the escalations?
    timeout:
      after: 24h                # {n}m | {n}h | {n}d
      onTimeout: reject         # reject | approve
  - id: escalate
    customJobRef: ops-team/weekly-report
    intent: escalate
    context:
      - reports/**              # glob over the artifacts tree
```

## Job steps

`{ id, customJobRef, intent?, directive?, context?, needs?, on? }` — no
`type` key.

- `customJobRef` is `{agentId}/{jobId}`, and the pair plus the pinned `intent`
  must exist — a step addresses a finished agent's catalog, never work nobody
  has authored yet.
- `directive` is that step's work order, under the same length ceiling as a
  chat directive. Omitted or blank, the runtime dispatches a standard "carry
  out this intent" statement — omit it when the pinned intent's definition
  already is the specification.
- Template variables — exactly three: `{{trigger.fireDate}}` (ISO time of the
  fire), `{{trigger.fireEpoch}}`, `{{run.id}}`. Anything else is rejected at
  save, and `{{steps.*}}` is reserved; data moves between steps through
  artifacts and `context`, not through directive text.
- `context` pins ride into the step as attachments: concrete
  container-relative artifact paths, or globs over the artifacts tree — the
  upstream intent's `hooks.stop` globs are the natural pins, because they are
  that step's output contract. A glob may not target `sessions/`. Concrete
  paths are existence-checked at dispatch, and a glob matching nothing fails
  the step.

## Approval gates

`{ id, type: approval, prompt, needs?, on?, channels?, timeout? }`

- `prompt` is what the approver reads — say what happened upstream and what
  approving will run. Same length ceiling as a directive.
- A gate must have an upstream step (it cannot be the entry step): its card in
  chat anchors to the producing job's turn.
- `channels` supports only `inApp` today. `timeout.after` is `{n}m|h|d`;
  `timeout.onTimeout` is `reject` or `approve`. No timeout means the gate
  waits indefinitely.

## The graph

- A step with no `needs` follows the previous step in file order; `needs: []`
  makes it a root. The graph must be acyclic, and every `needs` entry must
  name an existing step.
- `on` judges the upstream outcome: `success` (default), `failure`, `always`.
  A step whose condition does not match is **skipped**, and a skipped need is
  neither success nor failure — skips cascade.
- `defaults.onStepFailure: abort` cancels everything still pending on the
  first failure; `continue` lets independent branches finish.
- Branches never run concurrently: at most one job step is in flight per run,
  so fan-out siblings execute one at a time in file order. Branch for
  routing (`on:`) and failure isolation, not for speed.

## Keys that are rejected on purpose

The validator refuses unknown keys loudly, and these by name, so an author
never concludes a silently ignored knob works:

| Key | Why |
|---|---|
| `enabled` | availability is a sidecar — a person enables in the Pipelines tab |
| `projectId` | the project binding is set when a person activates, not in the definition |
| `retry`, `remindAfter` | reserved — not supported yet |
| `jobType`, `feature` | reserved for a future step kind |
| `overlap: cancelPrevious` | reserved — use `skip` or `queue` |
| `{{steps.*}}` in a directive | reserved — step-output substitution does not exist yet |

## Caps

At most 20 pipelines per account, 20 steps per pipeline, 3 concurrent runs per
activator, and no two fires closer than 5 minutes — judged by sampling the
next ten fires of the actual expression, so a clever expression is judged by
what it does.

## The lifecycle you do not own

A saved definition is a **disabled draft**. A person enables it (which
re-validates it), activates it on one or more projects, and from then on the
definition is immutable until every activation is gone and someone disables
it. Runs bill the activator, run history lives with the activation, and an
active pipeline owns its project — interactive jobs there are refused while
the binding exists. Your half ends at a draft that previews correctly; say so
in every report.

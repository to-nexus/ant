# Pipeline definition contract

A pipeline is ONE definition object: an optional trigger plus a chain of
steps. This is every field the validator accepts and every rule it enforces.
The definition rides the save routes as the JSON value of `def`; it is shown
here as YAML for readability — the two shapes are the same object.

## A complete definition

```yaml
version: 2                      # required, exactly 2
name: Weekly ops report         # required, at most 100 characters
on:                             # OPTIONAL — omit `on` entirely for a
  schedule:                     # manual-only pipeline (fires only via
    cron: '0 9 * * 1'           # Run now). 5-field cron, IANA tz
    tz: Asia/Seoul              # (omitted = UTC)
    onMissed: skip              # skip (default) | runOnce
    overlap: skip               # skip (default) | queue
  runCompleted:                 # pipeline→pipeline chaining: fires when
    pipelineId: weekly-ops      # that pipeline's run (the SAME activator's)
    statuses: [completed]       # seals one of these terminal statuses
                                # (default [completed]; ['failed'] = an
                                # error-handler pipeline). `schedule` and
                                # `runCompleted` may coexist. Chain depth
                                # is bounded (5) against fire loops.
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
- Template variables: `{{trigger.fireDate}}` (ISO time of the fire),
  `{{trigger.fireEpoch}}`, `{{run.id}}`, `{{run.prevSuccess.fireDate}}` /
  `{{run.prevSuccess.fireEpoch}}` (the previous COMPLETED run of this
  activation — empty on the first run; the natural "process everything since
  the last successful run" watermark), plus step-output references —
  `{{steps.<stepId>.answer}}` (the referenced step's final answer text) and
  `{{steps.<stepId>.artifacts}}` (newline-joined paths its intent's stop-hook
  globs matched at completion). A step-output reference must name an upstream
  dependency in this step's `needs` chain (never itself, never a gate) — that
  ordering is what guarantees the value exists at dispatch. Anything else is
  rejected at save (`steps.<id>.verdict` is reserved).
- Substituted directive text is a SUMMARY channel. Structured data still moves
  between steps as artifacts + `context` pins: a producing intent should write
  a manifest artifact (stable path, JSON) and declare it in `hooks.stop`, and
  the consumer pins it — `{{steps.*.answer}}` complements that, it does not
  replace it.
- `context` pins ride into the step as attachments: concrete
  container-relative artifact paths, or globs over the artifacts tree — the
  upstream intent's `hooks.stop` globs are the natural pins, because they are
  that step's output contract. A glob may not target `sessions/`. Concrete
  paths are existence-checked at dispatch, and a glob matching nothing fails
  the step.
- Pins accept the STATIC template variables (`{{trigger.*}}` / `{{run.*}}`,
  substituted before expansion) — `reports/{{trigger.fireDate}}/**` pins
  exactly this run's partition, which is how a business-key-partitioned
  manifest gets run-scoped isolation. `{{steps.*}}` is directive-only and
  rejected in pins.
- `retry: { max: 1..3, backoff?: "{n}m|h|d" }` re-dispatches the step on a
  RETRYABLE failure (job failure, infra interruption, enqueue failure, step
  timeout) — never on standing failures (approval/membership/credits/
  definition), and never on a human stop. Each round is a fresh job carrying a
  retry preamble that tells the agent what failed. **Declare retry only on
  re-entrant intents**: a failed attempt may already have completed side
  effects (an API write, a posted record), so the intent's prompt must say to
  check current state before acting. Default backoff is 1m.
- `timeout: { after: "{n}m|h|d" }` bounds one run's wall clock; on expiry the
  job is killed and the step FAILS (an `on: failure` branch consumes it, and
  `retry` composes — a timed-out round can retry). The bound stands down while
  the step awaits a clarify answer (human waits are open-ended).

## Approval gates

`{ id, type: approval, prompt, needs?, on?, channels?, timeout? }`

- `prompt` is what the approver reads — say what happened upstream and what
  approving will run. Same length ceiling as a directive. Resolving a gate
  sends `decision` (`approve` | `reject`) and nothing else: there is no field
  for a note, a value or a file, so a prompt that asks the approver to enter
  something describes a channel that does not exist.
- A gate must have an upstream step (it cannot be the entry step): its card in
  chat anchors to the producing job's turn.
- `channels` supports only `inApp` today. `timeout.after` is `{n}m|h|d`;
  `timeout.onTimeout` is `reject` or `approve`. No timeout means the gate
  waits indefinitely.
- `remindAfter: "{n}m|h|d"` re-surfaces an unresolved gate on that cadence
  (inbox refresh + a reminder line in chat, bounded rounds) — use it on gates
  whose timeout is long or absent, so a waiting run is never forgotten.

## Tool approvals (automatic — no step to author)

A step's job that issues a tool declared `tools.approval: always` PAUSES the
run: the exact call appears in the pipeline inbox and a person approves
(the run resumes and performs it) or rejects (the step fails —
`on: failure` consumes it). This is per-CALL approval inside a step; an
approval STEP gates the transition BETWEEN steps. Prefer intents whose
approval posture matches the wiring: don't add an approval step to guard a
write that its own intent already gates per call.

## The graph

- A step with no `needs` follows the previous step in file order; `needs: []`
  makes it a root. The graph must be acyclic, and every `needs` entry must
  name an existing step.
- `on` judges the upstream outcome: `success` (default), `failure`, `always`,
  or `verdict:<outcome>`. A step whose condition does not match is
  **skipped**, and a skipped need is neither success nor failure — skips
  cascade.
- **Verdict routing** (`on: verdict:<outcome>`): when an upstream step's
  pinned intent declares an `outcomes` vocabulary (in that intent's `infer.md`
  frontmatter — read it via the agents API), the run seals one verdict and
  branches route on it — the switch pattern: one downstream step per outcome,
  each `needs` the deciding step with its `on: verdict:…`. A run that seals no
  valid verdict FAILS the deciding step (`missing-verdict`, retryable) unless
  that step declares `onMissingVerdict: <outcome>` (or `fail`, the default).
  Only compose verdict edges against intents that actually declare the named
  outcome — a typo'd name is a branch that always skips.
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
| `retry` on a gate / `remindAfter` on a job step | each belongs to the other step kind |
| `jobType`, `feature` | reserved for a future step kind |
| `overlap: cancelPrevious` | reserved — use `skip` or `queue` |
| `{{steps.<id>.verdict}}` in a directive | reserved — a verdict routes edges (`on: verdict:<outcome>`), it is never substituted into directive text |

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

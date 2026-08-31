# Pipeline definition contract

One pipeline is one document: a cron trigger plus a graph of steps. This is
every key the validator accepts and every rule it enforces on them.

## Shape

```yaml
version: 2
name: 'Weekly report'
on:
  schedule:
    cron: '0 9 * * 1-5'      # 5 fields, parsed server-side
    tz: 'Asia/Seoul'         # IANA timezone. Default: UTC
    onMissed: skip           # skip | runOnce
    overlap: skip            # skip | queue
defaults:
  onStepFailure: abort       # abort | continue
steps:
  - id: collect
    customJobRef: 'ops/weekly'      # {agentId}/{jobId}
    intent: gather                  # 0..1 catalog intent id
    directive: 'Collect this week's sources, up to {{trigger.fireDate}}.'
    context: ['reports/template.md']
  - id: sign-off
    type: approval
    prompt: 'Review the draft before it is sent.'
    needs: [collect]
    channels: [inApp]
    timeout:
      after: '24h'
      onTimeout: reject             # reject | approve
```

Top level accepts exactly `version`, `name`, `on`, `defaults`, `steps`.
Anything else is rejected by name.

- `version` must be `2`.
- `name` is non-empty, at most 100 characters.
- `on.schedule` is required; `on` accepts nothing else.
- `steps` is a non-empty array, at most **20** entries.

## Job step

Keys: `id`, `customJobRef`, `intent`, `directive`, `context`, `needs`, `on`.
A job step carries no `type`.

- `id` — lowercase letters, digits and hyphens, unique within the pipeline.
- `customJobRef` — `{agentId}/{jobId}`. Both halves must resolve to something
  that actually exists; the definition itself cannot tell you, so check the
  agent through the API before you compose.
- `intent` — at most one, a catalog intent id of that job (or `general`).
  Pinned at authoring time and never re-classified at runtime.
- `directive` — non-empty, at most 100000 characters.
- `context` — array of non-empty container-relative artifact paths, pinned as
  `@ctx` and existence-checked when the step dispatches.

## Approval step

Keys: `id`, `type`, `prompt`, `needs`, `on`, `channels`, `timeout`.

- `type: approval` is required; omitting it makes the entry a job step and the
  missing `customJobRef` is what you will see in the error.
- `prompt` — non-empty, at most 100000 characters.
- `channels` — non-empty array; `inApp` is the only supported value today.
  `slack` and `email` are reserved and rejected.
- `timeout` — `{ after, onTimeout }` and nothing else. `after` is a duration
  literal `{n}m`, `{n}h` or `{n}d`. `onTimeout` is `reject` or `approve`.
  Omitting `timeout` means the gate waits indefinitely.
- **A gate cannot be the entry step.** Its card anchors to the turn of the job
  step above it, so an approval with no upstream step is refused at save time.

## The graph

- `needs` omitted means the previous step in file order. `needs: []` makes the
  step a root.
- `needs` must reference existing step ids, must not reference the step itself,
  and the whole graph must be acyclic.
- `on` judges the outcomes of the step's needs: `success` (the default),
  `failure`, or `always`. A condition that does not match SKIPS the step, and
  the skip CASCADES — a skipped need is neither a success nor a failure, so
  everything below it skips too.
- `defaults.onStepFailure: abort` (the default) cancels the still-pending steps
  on the first failure and seals the run failed. `continue` lets independent
  branches finish and seals `partial` on mixed outcomes.

## Directive templates

Substitution is a whitelist, not a template engine. Exactly three variables:

| Variable | Value |
|---|---|
| `{{trigger.fireDate}}` | the intended firing slot, as a date |
| `{{trigger.fireEpoch}}` | the same slot, epoch milliseconds |
| `{{run.id}}` | this run's id |

Any other `{{…}}` is rejected. In particular `{{steps.*}}` — passing one step's
output into the next step's directive — is reserved and not supported: steps
share state through the project's artifacts, not through the definition.

## Caps

| Cap | Value |
|---|---|
| pipelines per account | 20 |
| steps per pipeline | 20 |
| minimum cron interval | 5 minutes |
| concurrent runs per activator | 3 |

The interval is judged by what the expression DOES — the server samples the
next firings — so an expression that is fine on paper can still be refused.
`POST /definitions/pipelines/preview-fires` is where you find that out.

## Keys that are rejected on purpose

A knob that looks plausible and is silently ignored is worse than one that
fails, so each of these answers with a message saying it is not supported yet.
Do not offer them to the user as working.

| Key | Where |
|---|---|
| `projectId` | top level — the project binding moved to activation |
| `retry` | step — scheduler-level retry is a later knob |
| `remindAfter` | step — reminder arms are a later knob |
| `jobType` / `feature` | step — canonical (non-universal) steps are a later axis |
| `overlap: cancelPrevious` | `on.schedule` — use `skip` or `queue` |

## The lifecycle you do not own

A definition is only half of a running pipeline, and the other half is a
person's.

- **Availability.** A new pipeline is `disabled` — a draft. `disabled` is the
  only state in which it can be edited or deleted; `enabled` is the only state
  in which it can be activated. Enabling and disabling are done by a person.
- **Activation.** Activating binds the pipeline to one project. One project
  holds at most one activation, and one pipeline may be activated on many
  projects at once, by many people. Activating requires a quiet project and a
  person; while it holds, every interactive job start on that project is
  rejected, and the definition becomes immutable.
- **Firing.** All work bills to whoever activated it. Nothing fires from the
  definition alone.

So the last thing you say in an authoring turn is what remains: enable it, then
activate it on a project. A pipeline that is saved, valid, and never enabled is
a pipeline that never runs, and only your report can tell the user that.

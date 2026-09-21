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
  upstream:                     # pipeline→pipeline edge: this pipeline hangs
    pipelineId: weekly-ops      # off ONE node of that pipeline's runs (the
    step: verify                # SAME activator's). `step` names the node;
    when: verdict:pass          # omit it for the run itself — its seal judged
    overlap: skip               # as a node: completed = success, failed or
                                # partial = failure, cancelled = did not
                                # happen. `when` is the step-edge vocabulary:
                                # success (default) | failure | always |
                                # verdict:<a|b> (needs `step`; an outcome the
                                # step's intent declares). A step node fires
                                # the moment that step seals, mid-run, while
                                # the upstream run continues. A skipped or
                                # cancelled node never fires. `overlap` skip
                                # (default) | queue, for THIS fire source.
                                # `schedule` may coexist; chain depth is
                                # bounded (5). The fire lands on the
                                # activator's OTHER activated projects —
                                # never back where the node sealed — so the
                                # upstream run's artifacts sit in another
                                # container, out of pin reach: the case
                                # arrives as {{trigger.upstream.*}} (pipelineId,
                                # runId, outcome; with `step` also step,
                                # verdict, answer) in a DIRECTIVE, never in a
                                # pin. Pin only what this pipeline's own steps
                                # produce — and DO pin those: WITHIN this
                                # pipeline the duty is unchanged (what you
                                # pin, you needs).
concurrency: 1                  # live runs one activation may hold at once
                                # (1..3, default 1) — the SAME knob for every
                                # trigger: Run now, cron, upstream and fetch
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
acknowledged:                   # OPTIONAL — advisories you judged by-design
  - code: gate-holds-nothing    # an advisory code the save response named
    step: sign-off              # the step it named
    reason: >-                  # one sentence: why THIS flow wants the shape
      The gate's decision is the run's verdict; a chained pipeline reads it.
```

An UPSTREAM-fired pipeline's pins and case channel, demonstrated — this is
required content, not a template to copy:

```yaml
version: 2
name: Weekly ops follow-up
on:
  upstream:
    pipelineId: weekly-ops      # the weekly-ops RUN's own artifacts sit in
    step: verify                # another container — none of them is pinned.
    when: verdict:needs-fix     # fires the moment `verify` seals that verdict,
                                # while weekly-ops may still be running.
steps:
  - id: apply                   # entry step: no upstream step in THIS
    customJobRef: ops-team/weekly-report      # pipeline, so no pin — the case
    intent: verify-apply                      # arrives as the upstream node's
    directive: >-                             # fields, quoted as data.
      Run {{trigger.upstream.runId}} of weekly-ops sealed "{{trigger.upstream.verdict}}"
      at step {{trigger.upstream.step}}. Its findings:
      {{trigger.upstream.answer}}
      Apply the fixes those findings name; anything they do not name stays.
  - id: file-record
    customJobRef: ops-team/weekly-report
    intent: record
    context:
      - reports/*/verify-checklist.md   # verify's own stop glob: WITHIN the
                                        # chained pipeline every consumer
                                        # still pins its upstream steps'
                                        # outputs. Only the pins that would
                                        # cross INTO the upstream run's
                                        # container are out of reach.
```

## Discovery — one run per case

A pipeline that handles CASES (tickets, orders, records — each with its own
memory, gates and timeline) fires one run per case. Ant finds the cases in one
of two ways; the runs they produce are identical (same `{{trigger.item.*}}`
channel, same run label, same inbox attribution):

| | `on.fetch` | a step with `discovers:` |
|---|---|---|
| Who finds the cases | Ant's poller — no agent, no credits | that step's agent turn, as its directive says (an MCP server, an API, a database, files, judgment) |
| Where | before the run (a trigger) | any job step of the run — the steps after it run once per case |
| How the list is read | a declared REST request + item-paths | the turn's `<cases>` tag |
| Cadence floor | one minute | the pipeline's own trigger (cron: five minutes) |
| When there is no room | the item stays in the source and is seen next poll | the case is claimed and WAITS; it starts when a run finishes |

Choose `on.fetch` when the source can be asked "what is open right now" and
the answer can be trusted as-is — it costs nothing per poll. Choose
`discovers` when finding the cases needs judgment, a system without a REST
queue, or the result of an earlier step. The two never coexist on one
definition.

### The fetch trigger — one run per item of an external queue

`on.fetch` polls a REST source on an interval and fires ONE run per item that
has not been claimed yet. The external system (a ticket tracker, an inbox API)
is the queue; Ant keeps only the claim ledger. It stands alone — a fetch
pipeline has no `schedule` and no `upstream`.

The connection takes exactly ONE of two forms:

- **Inline** — `connection: { baseUrl, headers? }` on the trigger itself.
  Choose it when the source is only a queue that no step calls: declaring an
  `apis` entry on a job for it would hand that job's model tools it has no
  use for. It carries no `allow` and no `self` — the one declared `request`
  is its whole scope, and a poll needs an external API.
- **Bound** — `customJobRef` + `api`, naming an external entry in that job's
  `apis` map. Choose it when a step's job already reaches the same system:
  one declaration, no drift between what the poll reads and what the step
  writes. The request must then pass that entry's `allow` rules (the enable
  step tells you when it does not), and `self: true` entries are refused.

In both forms a credential is written as `${secret:KEY}` — KEY is upper-case
letters, digits and underscores, a name you mint — and resolves at poll time
from the ACTIVATOR's credential store, where the person who activates the
pipeline registers it. A literal token in a definition is a leak: definitions
are read back, shared and promoted.

```yaml
version: 2
name: Open tickets, one run each
on:
  fetch:
    connection:                      # INLINE form — the trigger's own connection
      baseUrl: https://jira.example.com
      headers:
        Authorization: ${secret:JIRA_TOKEN}   # the only credential form
    request:
      method: GET                    # GET, or POST for a search endpoint — writes are refused
      path: /rest/api/3/search       # /-rooted, under baseUrl
      query: { jql: "project = OPS AND status = Open" }
    items: $.issues                  # item-path to the array in the response
    key: $.key                       # item-path to each item's dedupe key — the run's case label
    fields:                          # optional, name → item-path; each becomes {{trigger.item.<name>}}
      summary: $.fields.summary
      channel: $.fields['customfield_10021'].value
    every: 5m                        # poll interval — {n}m|h|d, at least 1m
concurrency: 3                       # the SAME knob as every trigger: live runs one activation may hold
steps:
  - id: handle
    customJobRef: ops-team/tickets
    intent: triage
    directive: >-
      Handle ticket {{trigger.item.key}}. The ticket summary is:
      {{trigger.item.summary}}. Sales channel: {{trigger.item.channel}}.
```

The bound form replaces `connection` with the job binding — everything else
is the same:

```yaml
on:
  fetch:
    customJobRef: ops-team/tickets   # BOUND form — the job whose apis map names the connection
    api: jira                        # an external entry there; its allow rules must admit the request
    request: { method: GET, path: /rest/api/3/search }
    items: $.issues
    key: $.key
    every: 5m
```

- Item-paths are `$`, `.name`, `['name']` and `[n]` — no wildcards, filters or
  recursion. Keys must be simple identifiers (`OPS-42`, `inv_2026.09`); items
  whose key does not fit are skipped, duplicates within one response are
  first-wins.
- A poll admits items only while the activation has room under
  `concurrency`; an item it cannot run stays UNCLAIMED and is seen again next
  poll. Nothing is missed and nothing overlaps — which is why `overlap` and
  `onMissed` are refused on a fetch trigger.
- `{{trigger.item.key}}` and `{{trigger.item.<field>}}` are the run's case
  channel: reference them in the ENTRY step's directive, or the step has no
  way to learn which item it was fired for (the `entry-no-case-channel`
  advisory names this). Fields are directive-only; a context pin may use
  `{{trigger.item.key}}` alone (`cases/{{trigger.item.key}}/**`) — an item
  FIELD is text the source controls and must never name a path.
  `{{run.prevSuccess.*}}` is refused on a fetch pipeline: runs are per item,
  there is no previous-run watermark.
- Item fields are quoted source content of the same trust grade as
  `{{steps.*.answer}}`: write the directive so the step treats them as the
  case's DATA ("the ticket summary is: …"), never as instructions to follow.
- Run now on a fetch activation is **Poll now**: it polls immediately instead
  of starting a run. The editor's **Preview items** (`preview-fetch`) shows a
  person what a poll would see with their own credentials; that route refuses
  your token, so you verify the request shape and the item-paths from what
  you know of the source, and the report says the items were not previewed.

### The `discovers` step — one run per case the agent finds

Any job step may declare `discovers:`. Its turn then FINDS the cases — by
whatever the agent's definition and this step's directive say — and ends its
final reply with one `<cases>` tag (the runtime tells it so; you author
nothing about the tag). Every step downstream of it runs once per case, each
as an independent run; steps before it, and branches beside it, run once in
the discovery run.

```yaml
version: 2
name: Settlement discrepancies
on:
  schedule: { cron: '0 9 * * *', tz: Asia/Seoul }
concurrency: 3                    # how many case runs may be live at once —
                                  # the rest wait and start as runs finish
steps:
  - id: reconcile
    customJobRef: finance/settlement
    intent: reconcile
    directive: Reconcile yesterday's settlement batch and write the summary.
  - id: scan                      # the discovering step
    customJobRef: finance/settlement
    intent: find-discrepancies
    discovers:
      fields: [merchant, amount]  # the ONLY declaration: which case fields
                                  # the per-case steps may read. Never how
                                  # to find them — that is the intent's
                                  # prose and this directive.
      onMissing: fail             # fail (default) | complete — what a turn
                                  # that seals no <cases> tag means
    directive: >-
      From the reconciled batch ({{steps.reconcile.answer}}) list every
      merchant whose payout disagrees with the ledger. One case per merchant,
      keyed by the settlement line id.
  - id: handle                    # per case from here on
    customJobRef: finance/settlement
    intent: resolve
    directive: >-
      Resolve discrepancy {{trigger.item.key}} for {{trigger.item.merchant}}
      ({{trigger.item.amount}}). The batch summary: {{steps.reconcile.answer}}
    context:
      - cases/{{trigger.item.key}}/**
  - id: confirm
    type: approval
    prompt: Apply the correction for this discrepancy?
    remindAfter: 4h
  - id: record
    customJobRef: finance/settlement
    intent: record
```

- `discovers` is declared on at most ONE step per definition, on a job step
  (never a gate), never beside `on.fetch`, and needs at least one step after
  it. `fields` names are lowerCamel identifiers (at most 20; `key` is always
  carried and cannot be declared). The mechanism keys of `on.fetch` (`items`,
  `key`, `request`, a connection) are refused under `discovers` by name.
- `{{trigger.item.key}}` and the declared `{{trigger.item.<field>}}` are the
  case channel of the PER-CASE steps only — a step before the fan-out, or on
  a branch beside it, has no case and may not reference them. The first
  per-case step should read the channel (`discovery-no-case-channel` names
  the omission), fields are directive-only, and a pin may use the key alone.
  The per-case steps see the discovery run's finished prefix — `{{steps.
  reconcile.answer}}` above resolves in every case run — and may `needs` only
  the discovering step or other per-case steps.
- The case `key` the agent seals is the case's stable business identity. Ant
  claims each key once, so a key already claimed (waiting, running or done)
  never fires again — that is what makes a daily re-discovery safe. Author
  the intent so the key IS the business id (an order id, a settlement line),
  never a date or a position in a list.
- `concurrency` is the one pacing knob, the same one every trigger uses: the
  seal claims every case at once; as many start as the activation has room
  for, and the rest start as runs finish — nothing is dropped. Under
  `concurrency: 1` the cases run one at a time
  (`discovery-under-serial-concurrency` says so).
- A turn that seals no `<cases>` tag fails the step (`missing-cases`,
  retryable) unless `onMissing: complete`; an explicit `<cases>[]</cases>` is
  "nothing to handle this run" and completes the discovery run quietly. The
  discovery run itself appears in the run history once; each case run
  appears with its case key as label and names the discovery run it came
  from.

## Job steps

`{ id, customJobRef, intent?, directive?, context?, needs?, on?, discovers? }`
— no `type` key.

- `customJobRef` is `{agentId}/{jobId}`, and the pair plus the pinned `intent`
  must exist — a step addresses a finished agent's catalog, never work nobody
  has authored yet.
- `directive` is that step's work order, under the same length ceiling as a
  chat directive. Omitted or blank, the runtime dispatches a standard "carry
  out this intent" statement — omit it when the pinned intent's definition
  already is the specification.
- Template variables: `{{trigger.fireDate}}` (ISO time of the fire),
  `{{trigger.fireEpoch}}`, `{{run.id}}` (this run's identifier — a name, never
  a date), `{{run.prevSuccess.fireDate}}` /
  `{{run.prevSuccess.fireEpoch}}` (the previous COMPLETED run of this
  activation — empty on the first run; the natural "process everything since
  the last successful run" watermark), plus step-output references —
  `{{steps.<stepId>.answer}}` (the referenced step's final answer text, with
  canonical tags such as `<checklist>` / `<verdict>` stripped) and
  `{{steps.<stepId>.artifacts}}` (newline-joined paths of the files THAT
  step's job wrote which satisfy its intent's stop-hook globs — this run's
  own, never every case in the tree). A step-output reference must name an upstream
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
  sends `decision` (`approve` | `reject`) plus an optional note that lands in
  the run's audit record only — nothing the approver types reaches any step,
  so a prompt that asks the approver to enter a value describes a channel
  that does not exist.
- A gate must have an upstream step (it cannot be the entry step): its card in
  chat anchors to the producing job's turn. It arms as soon as its `needs` are
  satisfied — a sibling job step still in flight does not hold it back (the
  run's one-job-at-a-time rule orders the JOBS, not the gate), so a prompt can
  only assert what its own needs guarantee.
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
approval STEP gates the transition BETWEEN steps.

## The graph

- A step with no `needs` follows the previous step in file order; `needs: []`
  makes it a root. The graph must be acyclic, and every `needs` entry must
  name an existing step.
- `on` judges the upstream outcome: `success` (default), `failure`, `always`,
  or `verdict:<outcome>`. A step whose condition does not match is
  **skipped**, and a need that did not happen — skipped, or cancelled by an
  abort — is neither success nor failure. Non-occurrence cascades, `on:
  always` included: `always` means "whatever the outcome", never "even if it
  never ran". A branch therefore cannot be rejoined: a step needing two arms
  of a switch never runs, because only one arm ever does.
- **Verdict routing** (`on: verdict:<outcome>`): when an upstream step's
  pinned intent declares an `outcomes` vocabulary (in that intent's `infer.md`
  frontmatter — read it via the agents API), the run seals one verdict and
  branches route on it — the switch pattern: a downstream step per outcome that
  needs its own steps, each `needs` the deciding step with its
  `on: verdict:…`. A step owed to MORE than one outcome takes the disjunction
  `on: verdict:a|b` (matches any member) — never a duplicated step per arm,
  and never an unconditional step that re-judges what the verdict already
  decided. An outcome whose only consequence is that the OTHER
  outcome's steps do not run needs no edge of its own: absence is its branch,
  and what matters is that every step which must run for it stays reachable. A run that seals no
  valid verdict FAILS the deciding step (`missing-verdict`, retryable) unless
  that step declares `onMissingVerdict: <outcome>` (or `fail`, the default).
  Only compose verdict edges against intents that actually declare every named
  outcome — a typo'd name, in a single edge or one `|` member, is a branch (or
  half a branch) that always skips.
- **Gate routing** (reviewer nomination): the step a gate directly `needs` may
  end its reply with one `<assignee>member-id</assignee>` naming who that
  gate should reach for THIS run; the runtime keeps it only when the id is on
  the gate's approver roster (set on the activation, never in this file) and
  otherwise calls every approver. It routes attention only — any approver may
  still decide, and any approver can reassign from the inbox. Author it as
  prose in the agent's definition ("payments cases go to …"), not as a field
  here: there is no `assignee:` key.
- `defaults.onStepFailure: abort` cancels everything still pending on the
  first failure — including an already-armed gate whose `on` consumes success,
  because the work it guarded is cancelled and the run must be free to seal;
  `continue` lets independent branches finish.
- Branches never run concurrently: at most one job step is in flight per run,
  so fan-out siblings execute one at a time in file order. Branch for
  routing (`on:`) and failure isolation, not for speed.

## Acknowledging an advisory

A save answers `advisories.open` for wiring shapes that are legal but tend to
die silently at run time — a gate with neither `timeout` nor `remindAfter`, a
gate no step `needs`, a pin no sibling step produces or that sits outside the
pinning step's `needs` chain, a step pinning its own output, an outcome no
edge routes and no `onMissingVerdict` catches, a `*` pin whose consumer's
directive threads no case identity, an entry step with no channel to learn
its case, a `{{run.prevSuccess.*}}` watermark read under a `concurrency`
above 1 (sibling runs finish in any order). They never block a save or an
enable. Each is closed one of two
ways: change the definition, or record that the shape is right for this flow
in `acknowledged:` — `code` (as the response spelled it), `step` (an existing
step id), `reason` (non-empty; a sentence that restates the finding is not
a reason — an auditor names it as a defect). The same `(code, step)` twice is an error. An
entry whose shape no longer fires comes back as `advisories.stale`: remove
it. The Pipelines tab shows open advisories amber and acknowledged ones with
your reason, so what you sign is what the owner reads.

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
| `overlap` / `onMissed` under `on.fetch` | a poll admits items up to the room under `concurrency`; unclaimed items are seen again — nothing to skip or queue |
| `customJobRef` + `api` beside `connection` under `on.fetch` | exactly one connection form: a job's declared `apis` entry, or the trigger's own inline connection |
| `allow` / `self` under `on.fetch.connection` | an inline connection is connectivity only — the declared request is its whole scope, and a poll needs an external API |
| `on.fetch` beside `schedule` / `upstream` | a polled pipeline fires per item, not on a clock or an upstream node |
| `on.runCompleted` / `statuses` | retired — the edge judges a NODE: `on.upstream { pipelineId, step?, when? }`; `[completed]` → `when: success`, `[failed, partial]` → `when: failure`, `[cancelled]` has no equivalent (a cancelled run did not happen) |
| `on.upstream.when: verdict:*` without `step` | a run seal carries no verdict — name the step whose intent declares the outcome |
| `{{trigger.upstream.*}}` without `on.upstream`, `step` / `verdict` / `answer` on a run-node edge, or any of them in a context pin | the fields exist only with the trigger (the step-bound ones only with `step`), and another run's text never names a path in this project |
| `{{run.prevSuccess.*}}` on a fetch pipeline | runs are per item — there is no previous-run watermark |
| `{{trigger.item.*}}` without `on.fetch` or a `discovers` step upstream, or an undeclared field | there is no case without one of the two; declare fields under `on.fetch.fields` or the discovering step's `fields` |
| `discovers` on a gate, on two steps, beside `on.fetch`, or on the last step | a gate decides, it discovers nothing; two fan-outs would multiply cases into a product; a fetch pipeline already fires per item; the steps AFTER the discovering step are what run per case |
| `items` / `key` / `request` / a connection / `max` under `discovers` | the mechanism is the intent's prose and the directive, never a declaration; `concurrency` paces the case runs |
| `{{run.prevSuccess.*}}` on a per-case step, or a per-case step that `needs` a step beside the fan-out | a case run has no watermark and never waits on the discovery run's other branches |
| `{{steps.<id>.verdict}}` in a directive | reserved — a verdict routes edges (`on: verdict:<outcome>`), it is never substituted into directive text |

## Caps

At most 20 pipelines per account, 20 steps per pipeline, 3 concurrent runs per
activator, `concurrency` at most 3 per activation, and no two fires closer than
5 minutes — judged by sampling the next ten fires of the actual expression, so
a clever expression is judged by what it does. A fetch trigger polls at most
once a minute; a poll inspects at most 200 items of the response, and a
discovering step's `<cases>` list is read up to 200 cases.

## The lifecycle you do not own

A saved definition is a **disabled draft**. A person enables it (which
re-validates it), activates it on one or more projects, and from then on the
definition is immutable until every activation is gone and someone disables
it. Runs bill the activator, run history lives with the activation, and an
active pipeline owns its project — interactive jobs there are refused while
the binding exists, and a project holds exactly ONE active pipeline (a second
activation answers 409 `project-has-active-pipeline`). So a flow you split at
a human boundary cannot have both halves activated on one project at the same
time: the hand-over is a SWAP — deactivate the upstream pipeline, then activate
the downstream one on the same project. Deactivating removes only the binding,
so the upstream run's artifacts stay in that container and the downstream
pipeline's pins still reach them. Never write a hand-over telling the operator
to activate both at once. An activation holds `concurrency` live runs — one
unless the definition raises it, at most 3 — each with its own memory, gates
and timeline; at that cap Run now answers 409 with `existingRunIds`, and a
cron or chain fire follows its `overlap` policy. `clarify` carries text
under the directive ceiling and is withdrawn after three rounds within one
step's run. Your half ends at a draft that previews correctly; say so in every
report.

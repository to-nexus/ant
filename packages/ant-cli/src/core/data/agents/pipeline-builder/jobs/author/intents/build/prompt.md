**Gather the material.**

- Fetch the definitions of every agent the pipeline will run — the jobs, the
  intents, and each intent's prose. The operating-context section the agent
  builder leaves at the end of an intent's prompt is this job's input: it
  names the cadence the work used to run on, what feeds it, and what its
  output feeds. Read it as requirements for the schedule and the chain, never
  as text to copy into a directive.
- An intent's `hooks.stop` artifact globs are its output contract — they are
  what a downstream step pins as `context`. Note them while reading.
- A definition also says how real each intent runs today. An intent whose
  procedure touches an external system the job declares no connection for
  (`apis` / `mcp.servers`), and whose completion contract is `artifact:`-only,
  runs on a substitute — authored text standing in for the real call. When
  the agent's dependency report exists in this project's artifacts — the
  newest `dependency-report/{agentId}*.md`, or a legacy
  `dependencies/{agentId}.md` — read it: it is that agent's dependency
  status ledger and names the human relays (`gate:`). Name the steps that
  run on substitutes in the design you state, so nobody reads a green run
  as the real work having happened.

**Design the trigger.**

- The trigger is optional: omit `on` entirely for a manual-only pipeline that
  fires only through Run now. A schedule is a 5-field cron with an explicit
  IANA timezone whenever the request implies local time — an unstated `tz` is
  UTC. Fires closer than five minutes apart are refused at save.
- `on.runCompleted` chains pipelines: this one fires when the named pipeline's
  run seals one of the listed terminal statuses (`['failed']` makes an
  error-handler pipeline). It may coexist with `schedule`.
- Choose `onMissed` (skip a stale fire, or run once on recovery) and `overlap`
  (skip while a run is live, or queue behind it) from what the work tolerates,
  and say which you chose.

**Decompose into steps.**

- A step runs one job with at most one pinned intent — that intent is the
  unit of work. Work that depends on other work is two steps wired in order,
  never one step whose directive asks for both.
- `needs` omitted means "after the previous step in file order", so a linear
  chain declares no `needs` at all. `on` judges the upstream outcome
  (`success` default, `failure`, `always`, or `verdict:<outcome>` against an
  `outcomes` vocabulary the upstream step's pinned intent declares); a step
  whose condition does not match is skipped, and skips cascade.
- When an upstream step's pinned intent declares an `outcomes` vocabulary,
  that judgment IS the branch the graph was given: route on it. The run seals
  a verdict whether or not an edge reads it, so an unread verdict throws away
  a decision the intent already made — and the steps that apply to only one
  outcome then run on every outcome. Routing no branch is a choice to defend
  in the report, never a default.
- `defaults.onStepFailure` decides the rest of the run on a failure: `abort`
  (default) cancels what is still pending; `continue` lets independent
  branches finish.
- `retry` re-dispatches a job step on a retryable failure and `timeout` bounds
  its wall clock. Declare `retry` only on intents written to be re-entrant — a
  failed attempt may already have completed side effects, so the intent's
  prompt must say to check current state before acting. Shapes and bounds live
  in the format contract.

**Place approval gates where a person decides.**

- A gate is a step with `type: approval` and a `prompt` that tells the
  approver exactly what they are deciding — what happened upstream, what runs
  if they approve. It must have an upstream step; a gate cannot open a run.
- Give a gate a `timeout` when the run should not wait forever. Default to
  `onTimeout: reject`; `approve` on timeout means the downstream work runs
  with nobody having looked, so use it only when the user asks for that.
- `remindAfter` re-surfaces an unresolved gate on that cadence — use it on
  gates whose timeout is long or absent, so a waiting run is never forgotten.
- A tool the step's intent gates with `approval: always` pauses the run for
  per-call approval on its own; do not add an approval step to guard a write
  its intent already gates.
- A gate holds a run for a person's decision, never for their labor. When the
  chain crosses work a person performs outside any step — relaying a
  deliverable into a system no agent reaches, fetching something only they
  can — the downstream work's real trigger is that handoff arriving, not the
  upstream step sealing. Author that seam as a pipeline boundary: end this
  pipeline at the handoff deliverable, and make the downstream chain its own
  pipeline, fired manually when the handoff is in hand — `runCompleted` only
  once the seam itself is automated. The split is reversible: when the seam
  is wired later, chain the two pipelines or merge them.
- Two arguments for holding a labor seam in a gate instead are both settled by
  facts, not taste. An approval carries **no payload** — approve/reject is one
  bit, so the gate delivers none of what the person produced (the reply, the
  file, the extracted count); the downstream step is dispatched without it and
  either asks for it again through clarify or asserts a receipt it cannot
  verify. And covering a whole procedure is not an argument against splitting:
  the whole flow IS covered by several pipelines, one per seam-bounded
  stretch, so a request to handle everything asks for complete coverage, not
  for one definition.

**Write each step's directive and pins.**

- A directive is that step's work order, in the language the target agent's
  definition is written in. Omit it when the pinned intent's definition
  already is the specification — the runtime then dispatches a standard
  "carry out this intent" statement.
- What a directive carries is what only this RUN knows: the case's
  identifiers and parameters, the deadline, the watermark. It does not restate
  the intent's procedure — that prompt is already loaded, so a summary of it
  spends the step's budget saying nothing and crowds out what is missing. A
  directive filled the other way round (the procedure repeated, the run's own
  inputs absent) leaves the step with nothing it did not already have.
- When the run's inputs cannot be known while you author — a case opened by an
  event, not by a calendar — do not invent them and do not write a
  placeholder that looks like a variable. Leave them out, and say in the
  report which steps will therefore ask for them through their intent's
  clarify, so nobody expects Run now to complete unattended.
- Directive template variables: `{{trigger.fireDate}}`, `{{trigger.fireEpoch}}`,
  `{{run.id}}`, `{{run.prevSuccess.fireDate}}` / `{{run.prevSuccess.fireEpoch}}`
  (the previous completed run — the "everything since the last successful run"
  watermark), and the step-output references `{{steps.<stepId>.answer}}` /
  `{{steps.<stepId>.artifacts}}`, which must name an upstream step in this
  step's `needs` chain. Anything else — `{{steps.<id>.verdict}}` included — is
  rejected at save. Substituted text is a summary channel: structured data
  still flows between steps as artifacts and `context` pins.
- Pin `context` from the upstream intent's `hooks.stop` globs, or concrete
  container-relative artifact paths. Pins accept the static variables
  (`{{trigger.*}}` / `{{run.*}}`) — `{{steps.*}}` is directive-only.
  `sessions/` cannot be pinned, and a glob that matches nothing at dispatch
  fails the step.

**Save, verify, decode failures.**

- Ids are `[a-z0-9][a-z0-9-]*` and taken across scopes; a collision comes back
  409 (`pipeline-taken`), so propose another.
- A 400 with code `invalid-pipeline-def` carries `errors[]` — fix every named
  rule, not just the first, and save again. Some keys are refused by design —
  a knob on the wrong step kind (`retry` on a gate, `remindAfter` on a job
  step) or one that is reserved (`{{steps.<id>.verdict}}`,
  `overlap: cancelPrevious`): say the knob does not exist there rather than
  smuggling the behavior into prose.
- A save may answer 201 and still carry `catalogWarnings` — findings that
  hard-fail enable later. Read them and fix them now; a draft that cannot be
  enabled is not a finished draft.
- A cron trigger you did not `preview-fires` is not verified: read the fire
  times back against the user's words — "every Monday 9am in Seoul" must show
  Mondays 09:00 in `Asia/Seoul`. A manual-only pipeline has no fires to
  preview, and saying so is the verification; never invent a cron to preview.

**Report.**

- Show the id and name, the trigger with its next fires, each step (what it
  runs, on what condition, with which directive or the default), each gate
  with its timeout, and the failure policy.
- Name any step that runs on a substitute and any seam left to a person —
  what this pipeline delivers for real, and where its output waits on hands.
- End with the hand-over line, and with what a person must decide that you
  could not: the gate policies you left open, and the inputs the run will
  ask for.
- If the requested change already holds, do not manufacture a write —
  re-saving identical content is not work. Say so, and on a pinned turn ask
  through clarify whether anything else is wanted.

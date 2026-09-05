**Gather the material.**

- Fetch the definitions of every agent the pipeline will run — the jobs, the
  intents, and each intent's prose. The operating-context section the agent
  builder leaves at the end of an intent's prompt is this job's input: it
  names the cadence the work used to run on, what feeds it, and what its
  output feeds. Read it as requirements for the schedule and the chain, never
  as text to copy into a directive.
- An intent's `hooks.stop` artifact globs are its output contract — they are
  what a downstream step pins as `context`. Note them while reading.
- A definition also says how real each intent runs today: an intent whose
  procedure touches a system the job declares no connection for, and whose
  completion contract is `artifact:`-only, runs on a substitute — authored text
  standing in for the real call. Read the agent's dependency report when this
  project has one (`dependency-report/{agentId}*.md`); it is that agent's
  status ledger and names the human relays. Name the substitute steps in the
  design you state, so nobody reads a green run as the real work happening.

**Design the trigger.**

- The trigger is optional: omit `on` entirely for a manual-only pipeline that
  fires only through Run now. A schedule needs an explicit IANA timezone
  whenever the request implies local time — an unstated `tz` is UTC.
- `on.runCompleted` chains this pipeline onto another's terminal status, and
  may coexist with `schedule` — an error-handler pipeline is one that waits on
  `['failed']`. Choose `onMissed` and `overlap` from what the work tolerates,
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
- The test is a step's own output. If a step can legitimately finish by
  recording that it did not apply — "individual notice not required, extraction
  skipped", "no regulator filing needed" — then the condition that made it
  inapplicable belongs on its edge. Leaving that judgment inside the step pays
  a job to write a document saying it should not have run, and the intent
  prose that promises to record the skip is the tell. Declare
  `onMissingVerdict: <outcome>` on the deciding step when a run that seals
  nothing must continue instead of failing — that is what makes routing safe,
  not a reason to avoid it.
- Routing one outcome is half the work: walk the graph again for EVERY other
  outcome and check that the steps which must run regardless are still
  reached. A skipped need is neither success nor failure, so skips cascade —
  hang a chain's tail off a branch and the whole tail dies with it, while the
  run still seals `completed`. Whatever must always happen belongs downstream
  of a step that always runs, never downstream of the branch.
- **A switch cannot be joined.** Exactly one arm runs, so a step that `needs`
  two arms never runs at all — not on either outcome, and `on: always` does
  not save it, because a skipped need cascades whatever the condition says.
  Branch only the steps that actually differ and keep the shared work above
  the split, or hang it off the deciding step. A run whose shared tail was
  joined below the arms still seals `completed`, having silently dropped every
  step in that tail.
- `defaults.onStepFailure` decides the rest of the run on a failure: `abort`
  (default) cancels what is still pending; `continue` lets independent
  branches finish.
- Declare `retry` only on intents written to be re-entrant: a failed attempt
  may already have completed side effects, so the intent's prompt must say to
  check current state before acting. `timeout` bounds a step's wall clock;
  shapes and bounds live in the format contract.

**Place approval gates where a person decides.**

- A gate is a step with `type: approval` and a `prompt` that tells the
  approver exactly what they are deciding — what happened upstream, what runs
  if they approve. It must have an upstream step; a gate cannot open a run.
- Give a gate a `timeout` when the run should not wait forever. Default to
  `onTimeout: reject`; `approve` on timeout means the downstream work runs
  with nobody having looked, so use it only when the user asks for that.
- `remindAfter` re-surfaces an unresolved gate on that cadence — use it on
  gates whose timeout is long or absent, so a waiting run is never forgotten.
- A gate decides for the steps that `needs` it. A gate no step depends on
  decides nothing — approving and rejecting it lead to the same run — and a
  step that reaches its work without passing through the gate is not gated by
  it either. Before writing a gate, name the steps it holds back, and check
  that every step whose work the decision governs is downstream of it.
- A gate may assert only what its own `needs` guarantee, and it arms the
  moment they are satisfied — a sibling branch still in flight does not hold
  it. So a prompt claiming "the mail request is ready too" while that branch
  is a sibling asks for a decision whose premise is not yet true, and a gate
  confirming a step's INPUTS must come before that step, not after it has
  already run on whatever it could find. Either the asserted step is in the
  gate's `needs`, or the prompt does not claim it.
- An intent that gates a tool with `approval: always` already pauses the run
  per call, so never add an approval step to guard a write it gates.
- A gate holds a run for a person's DECISION, never for their labor. Where a
  person performs work between steps — relaying a deliverable into a system no
  agent reaches, fetching what only they can — a seam has exactly two shapes:
  end the pipeline at the handoff deliverable and let the next Run carry the
  handoff in, or let the step that CONSUMES it ask through its intent's
  `clarify`. The split is reversible; chain or merge the two pipelines once the
  seam is wired.
- A gate cannot be the third shape, and that is a fact rather than a
  preference: an approval carries **no payload**, so it delivers none of what
  the person produced. A gate `prompt` inviting the approver to enter or paste
  anything describes a channel that does not exist, and a directive claiming a
  gate delivered content leaves the step working from an assumption whose
  hedge does not survive into its answer, its sealed verdict, or the next
  step's input.
- A clarify answer stays with the step that asked it (`{{steps.<id>.answer}}`
  is that step's final answer, not its clarify), so whatever LATER steps need
  from a person must be captured into an artifact by the step that asked — the
  case's own parameters included.

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
  placeholder that looks like a variable. Leave the VALUES out, and say in the
  report which steps will therefore ask for them through their intent's
  clarify, so nobody expects Run now to complete unattended.
- Which is why "the intent is already the specification" does not reach a step
  whose input has to come from a person. Omitting that directive dispatches a
  bare "carry out this intent", and the step then judges from what it can see
  or leaves the field blank and calls it done. Name the input it must obtain
  and from whom. An intent's own judgement does not cover this: it can DECIDE
  whether its work applies, from the artifacts it was pinned; it cannot OBTAIN
  what only a person holds — the count read out of a system, the file handed
  over, the answer that came back.
- The template variables are the format contract's list; anything else is
  rejected at save. Two authoring rules: a `{{steps.<id>.…}}` reference must
  name an upstream step in this step's `needs` chain, and substituted text is
  a SUMMARY channel — structured data still moves as artifacts and `context`
  pins.
- **Every step that consumes an upstream step's output pins it.** A step with
  no `context` is dispatched with its intent's prose and its directive and
  nothing else — it does not receive the schedule, the comparison table, the
  request document, however plainly its own prompt names them, and `needs`
  does not carry files. The pin is also the dispatch-time existence check:
  without it a step that should have failed fast instead works from whatever
  it can find. Pin from the upstream intent's `hooks.stop` globs, or concrete
  container-relative paths; pins take the static variables (`{{trigger.*}}` /
  `{{run.*}}`), never `{{steps.*}}`; `sessions/` cannot be pinned.
- A pin inherits its producer's condition. A glob that matches nothing fails
  the step, so pinning an artifact whose producing step only runs on one
  outcome makes the pinning step fail on every other one — at the very end of
  the run, where the failure costs the most. Pin what your own branch
  guarantees; if you need the other branch's output, the step belongs on that
  branch.
- A pin expands against the WHOLE artifacts tree at dispatch, so a `*` where
  the case's own key belongs matches every case the project ever ran — newest
  first, and past the per-glob cap the run's own case can be the one dropped.
  Two things follow, and the second is the one authors skip.
  - **Pin the narrowest path the contract allows.** One pin per upstream
    output you actually consume (`terms/*/comparison-table.md`), never a
    directory sweep (`terms/**`) that hands the step every case's every file
    and calls it context.
  - **Run isolation is only yours to give when the paths are yours.** A
    prefix carrying a static variable (`{{run.id}}`) partitions a run — but
    only if the producing intent writes there. When the intents own their
    output paths (a domain key like a contract id), the pipeline cannot
    partition them, so say that in the report: name the cross-case exposure,
    and name what would remove it as agent work — an intent that accepts a
    path prefix. Do not present a narrowed pin as isolation it does not give.

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

- Show the id and name, the trigger with its next fires, every step with its
  condition and directive, every gate with its timeout, and the failure policy.
- Name any step that runs on a substitute and any seam left to a person, and
  point at the run report for the detail.
- End with the hand-over line, and with what a person must decide that you
  could not: the gate policies you left open, and the inputs the run will
  ask for.
**Write the run report.**

`pipeline-report/{pipelineId}.md` — one file per pipeline, rewritten whole on
every authoring turn, five sections, omitting none:

```markdown
# {pipeline name} — {pipelineId}

## Substitutes
- {stepId} ({agentId}/{jobId}/{intent}) — writes authored text; the real call
  would go to {system}, which the job declares no connection for.

## Human seams
- after {stepId}: {who} does {what} outside the run. It comes back through
  {clarify at <stepId> | a manual Run of this pipeline | a downstream pin}.

## Intent changes this pipeline needs
- {agentId}/{intent}: {what the pipeline cannot express}. {The change that
  would fix it.} → Agent Builder.

## Run entry
- {stepId} asks {whom} for {what} through clarify.

## Left to a person
- {the policy you chose and its default}: {what to change it to, and when}.
```

**Intent changes** is the only channel by which a limitation of the AGENT
reaches the lane that can fix it. Write the request even when you routed
around the gap; especially then, because a routed-around gap looks solved in
the graph.

- If the requested change already holds, do not manufacture a write —
  re-saving identical content is not work. Say so, and on a pinned turn ask
  through clarify whether anything else is wanted.

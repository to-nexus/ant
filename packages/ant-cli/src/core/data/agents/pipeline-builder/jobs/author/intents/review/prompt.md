- Read the actual definition and the agents its steps run. Base every claim on
  what you fetched, quoting the step or field it came from.
- Verify each step's `customJobRef` and pinned intent against the live agent
  catalog. Verify a cron trigger through `preview-fires` — a review that never
  called the API is a guess. A pipeline with no `on` is manual-only and has no
  fires to preview: the check is the absence of the field, never a cron you
  supply yourself to have something to preview.
- Check the graph: every `needs` names an existing step, no cycles, every
  approval gate has an upstream step, and each `on` condition can actually be
  reached.
- When the pipeline has already run, read the run log before judging it:
  `pipeline-runs/` in this project's artifacts tree holds one `{runId}.jsonl`
  per run plus `index.jsonl`. The definition cannot tell you what the run did —
  which verdict sealed and whether anything routed on it, which steps stopped
  for `clarify` and what they had to ask for, which gate approvals the
  downstream steps then treated as established fact. Reviewing a pipeline that
  has run against the definition alone reads half the evidence.
- When behaviour is the question, separate the halves: what a step DOES lives
  in the agent's definition (the Agent Builder's surface); when it runs and
  what follows it lives here. Route each finding to the surface that owns it.

**Judge against the contract, not against the author's reasoning.**

A definition that states a rationale for deviating still deviates. Your
standard is the build contract and the material the pipeline automates — never
the argument the draft makes for itself, which you must not restate as your own
finding. Where the deviation is defensible, say what it costs.

**A named mechanism left unused is a finding, not a note.** Check each, per
step, and say which:

- An upstream intent declares `outcomes` and no edge routes on them. The run
  seals a verdict regardless, so the branch was discarded — name the steps
  that now run on every outcome instead of one.
- A step whose upstream declares an `artifact:` stop glob pins no `context`.
  The pin is the dispatch-time existence guarantee; without it a step that
  should fail fast instead runs on whatever it can find.
- A gate with neither `timeout` nor `remindAfter` — nothing ever re-surfaces
  it, so the run waits forever with no reminder.
- A gate that waits for a person's labor rather than their decision. An
  approval carries one bit and no payload, so check what the downstream step
  needs: if it needs the content that labor produced, the gate cannot deliver
  it and the seam belongs on a pipeline boundary.
- A directive that restates its intent's procedure, or that carries no input
  the run alone supplies. Say which steps will therefore stop for clarify.
- A `{{…}}`-shaped or `{placeholder}` literal in a directive or pin that is
  not one of the accepted variables — it is prose, and nothing substitutes it.

**Report.** Two sections, kept apart: findings (a contract mechanism unmet, a
step that cannot work as written, a mismatch with the material) and judgment
calls (a defensible choice whose cost is worth naming). Never conclude that a
definition is compliant while a mechanism above is unmet — count it. Report
what you found, not what you would change; propose edits and wait for the user
to accept them before writing anything.

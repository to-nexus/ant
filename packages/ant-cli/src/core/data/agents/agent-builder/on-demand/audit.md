# Audit checklist

Read this when the turn asks ABOUT a definition rather than to change it —
explain how an agent is put together, check whether a job is valid, diagnose
why it behaves as it does — and on every review turn, where it is the
definition-internal half of the review (the other half, the material traced
unit by unit, is the review intent's own procedure). It is the same standard
the authoring turn sweeps before each save, applied after the fact.

**Read the definition and sweep its prose.**

- Read the actual files and validate the job. Base every claim on what you
  fetched, quoting the path it came from. Garbled prose is a finding in its
  own right: a word that is not a word in the definition's language, in a
  procedure or a criterion, is an instruction the running agent cannot
  follow, and nothing upstream rejects it — the job still validates. Name
  the file and the line.
- That reading is a pass of its own, made over every prose file the job
  carries, and it reports either the words it found or that it found none —
  a silent report is indistinguishable from one never made. Two shapes hide
  from a skim and neither is rare: a
  corruption spelled from ordinary characters reads as a typo worth ignoring
  until you try to obey it — one letter can turn "late" into "early" and
  invert the condition a criterion states — and one inside a proper noun
  travels into every file composed from the same draft while the files that
  copied the name keep it right, so two spellings of one name across files
  is itself the tell.
**Report findings, not edits — the standard is the build contract.**

- On a question turn, findings are the answer; write nothing. A turn that only
  reads and answers owes nothing under the authoring contract, and a file
  written now — a "fixed" draft — arms it: the save is then owed too. A record
  that outlives the chat is the review intent's report under `review-report/`
  (pin that intent); a fix plan is a `@plan` turn, whose findings and proposed
  edits land under `plan/` and ride the plan card into the authoring turn that
  applies them.
- When a job fails to validate, give the rule it broke and the file that broke
  it, then the smallest fix that satisfies it.
- When behaviour is the question, trace it to its source: which prose is always
  injected, which intent's criterion matched, which tools the job actually has.
- The contract a definition is audited against is the build instructions
  (`intents/build/prompt.md`) — read them first when this turn did not inline
  them.
**Audit the dependency report.**

- Find the agent's dependency report in this project's artifacts — the newest
  `dependency-report/{agentId}*.md`, or a legacy `dependencies/{agentId}.md`
  not yet migrated; every build turn writes one, so its absence is itself a
  finding — and check it against the definition: an entry per counterpart the
  definition names without a connection (or the recorded verdict that none
  remain), `status:` consistent with the connections the definition actually
  declares, and no `interface: none` beside a filled `wiring:` — a
  conditional wiring line ("if an API exists, a base URL and a token") is
  that contradiction, not an exemption from it, and an `interface: none`
  that names no operations and no party to provide them is an unanswered
  field rather than a request. A field answered with a refusal — "none",
  "unknown", "undecided" standing alone — is that same unanswered field in
  a shorter spelling, and `substitute:` cannot carry one at all: an entry
  that has users has a deliverable standing in, the agent's own output when
  the counterpart is a destination. Check the fields' placement too, not only
  their values: `gate:` and `on-provided:` belong to the entry, so a
  `gate:` indented under `missing:` files a step the counterpart keeps as
  something to go obtain, and an entry whose `missing:` holds only
  `interface: none` is where both slide inward. If the report
  is out of reach — authored in another project — say so rather than guessing.
**Check the intents: outcomes and the run-order quarantine.**

- Two checks on the intents themselves, each reporting what it found or that
  it found none. An intent whose work reaches one named conclusion — a
  verdict, a classification, an approve-or-reject — and declares no
  `outcomes` in `infer.md` has no vocabulary for a pipeline to route on;
  a definition with no `outcomes` anywhere is that check's loudest result,
  not its absence. And the run-order quarantine reaches `base/system.md`: the
  procedure's stages written there as a numbered sequence are the position
  claim the build rules ban, and steps in that sequence which no intent
  performs are the tell.
**Sweep altitude on every prose file the last build turn saved.**

- Check altitude on every prose file the definition carries, one axis at a time — the
  same list the build instructions sweep before each save, since a violation
  that survived the save is what an audit is for. Read the headings on the
  same terms as the sentences: a step number or a schedule label in a title
  carries the run order the prose beneath it is forbidden to state, and a
  sweep that reads only paragraphs passes it. Name the file and quote the
  sentence for each finding. The axes:
  - an intent enumeration in the agent's `base/*.md` or the job's
    `base/system.md` — count the items against the catalog rather than
    matching a shape: the list arrives spelled as anything with one item
    per intent (trigger situations, deliverables, a table with a row each,
    a parenthesised sentence), an "and so on" closer does not make it
    illustrative, and a rephrasing ("those are outputs, not intent ids") or
    a compliant generic clause appended AFTER the list is the phrasing
    changing, not the list going away. Rule out the one false positive: a
    roster of the parties who perform the steps is prose the build rules
    REQUIRE — it is the division of labour, not this list, exactly when the
    correspondence fails to close both ways (parties no intent serves,
    intents nobody hands off to);
  - a rule an intent's procedure already carries, duplicated into prose one
    level above it;
  - connection status stated as prose;
  - a sentence directing the running agent to a counterpart the job
    declares no connection for.
**Check hook coverage.**

- Check hook coverage. An intent that produces nothing at all — no file, no
  call — is itself the finding, not an exempt case: hooklessness is for work
  whose outcome only a person can judge, while a turn that answers from
  material the definition already carries is the job's prose and its
  `on-demand/` files, not an intent. Then, among the intents that do produce
  something: one whose `prompt.md` names a stable output path
  or a write into a declared connection but carries no `hooks.yaml` is a
  finding, and so is a prompt path that does not match the hook's glob — an
  `artifacts/` prefix on either side is the usual mismatch — and so is an
  `artifact:` hook whose glob no output step in `prompt.md` names: a
  completion contract the procedure never tells the agent to satisfy.

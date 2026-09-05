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
- Report what you found, not what you would change: propose edits and wait
  for the user to accept them before writing anything.
- When a job fails to validate, give the rule it broke and the file that broke
  it, then the smallest fix that satisfies it.
- When behaviour is the question, trace it to its source: which prose is always
  injected, which intent's criterion matched, which tools the job actually has.
- The contract a definition is audited against is the build intent's
  instructions — not inlined on a review turn, so read them first.
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
- Two checks on the intents themselves, each reporting what it found or that
  it found none. An intent whose work reaches one named conclusion — a
  verdict, a classification, an approve-or-reject — and declares no
  `outcomes` in `infer.md` has no vocabulary for a pipeline to route on;
  a definition with no `outcomes` anywhere is that check's loudest result,
  not its absence. And the run-order quarantine reaches `base/system.md`: the
  procedure's stages written there as a numbered sequence are the position
  claim the build rules ban, and steps in that sequence which no intent
  performs are the tell.
- Check altitude on every prose file the turn saved, one axis at a time — the
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
- When the material the definition was authored from is still on the plane,
  read it and check the partition against it — walk the material's work
  units, not its section headings (one section usually holds several), and
  reject "that step is performed by a person" as the reason one is absent:
  it is true of nearly every step in a procedure, including the ones the
  intents you just passed do serve, whose deliverable is the request the
  human step consumes. The findings: a unit with its own trigger and its
  own output that no intent performs — missing from BOTH columns of the
  report's mapping, and showing from inside the definition as job prose
  carrying a rule for work no intent performs; a question the material's own
  form answers in every source file that no authored intent carries, which
  the unit count cannot show because every unit is present — read the
  material's headings, not only its units; an intent whose deliverable
  describes the work instead of being the work product; an `infer.md` that
  lists alternative tasks instead of naming one arriving situation —
  several intents under one name, where the merge clause is not the
  exemption it looks like (deliverables that each wait on a different
  predecessor are separate triggers however single the stage sounds, and
  the build rules' chaining arbiter decides). Three tells, and none is a
  matter of degree: `prompt.md` carries N numbered sub-procedures with
  their own inputs and outputs; the definition's OWN back-calculated
  schedule puts those units on days no single run can span; and the
  material itself argues the split — a note recommending a piece be
  separated, or two parties disagreeing where the line falls. Report it as
  structural, not as wording. The material's filing is not the unit list
  (one file or heading can hold several), so citing the filing to justify
  a one-row-per-file mapping restates that tell instead of rebutting it. Also findings: pieces the material marks as
  no longer in force that were carried in anyway — and the same marker read
  the other way, because it governs this sweep's own output too: a piece the
  material itself sets aside, in its own text or by where the collection
  files it, is not missing when the definition leaves it out, and reporting
  it as a gap is a finding the author can refute from the source you read.
  The report's mapping
  claim — what merged, what split, what was dropped — is a claim to verify
  against that material, not a finding to accept.
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

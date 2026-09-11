**What this turn produces, and what it does not.** One file: the review
report, written into this project's artifacts under `review-report/`. Nothing
else changes — no definition save, no "fixed" draft, no proposed file written
somewhere to show it. The standard you judge against is the authoring
contract, `intents/build/prompt.md`, read on this turn when it is not inlined;
the material the definition was authored from is the evidence you judge
with. When the user wants the findings turned into edits, that is a `@plan`
turn of the authoring intent, and the plan card carries it there. Your reply
is the summary; the report is the deliverable.

**Locate the three inputs before reading any of them closely.**

- The definition: the `_agents/{agentId}/…` files the turn attached, else
  `list_files _agents/{agentId}/` and `read_file` every file it lists —
  `GET /definitions/agents/{agentId}/files` and `…/file?path=` return the
  same bytes when the mount is out of reach. Every file, not the ones that
  look relevant: an unsourced rule hides in `base/` prose as readily as in an
  intent.
- The material: the directory the turn attached under Attached Context. The
  band's hint to "read only what you need" does not apply to a review — see
  the next step.
- The authoring report: the newest `dependency-report/{agentId}*.md` in this
  project's artifacts, or a legacy `dependencies/{agentId}.md` not yet
  migrated. Its absence is itself a finding, recorded and then worked around:
  the trace still runs, with every `claim` cell reading `not-claimed`. A
  report authored in another project is out of reach — say so rather than
  guessing at it.
- When the definition or the material is not in hand and nothing in the turn
  says where it is, ask through clarify — one question naming what is missing
  and where it is expected — and stop. A review of a definition against
  memory is not a review, and a report written from one is worse than none.

**Enumerate before judging.** `list_files` the material directory
recursively — every sub-folder, `deprecated/` included — and record the
count. That listing is the floor under the trace: every file it names gets at
least one row, and the report's invariant line says so in numbers (`files
listed: N · rows: M · files without a row: 0`). Read every file first-hand on
this turn, in full. Two things in this session try to talk you out of it, and
both are the failure this intent exists to prevent: the already-read
manifest, which says a file's content is already above (it may be, compacted
and read for a different purpose — a row citing a phrase is the only proof a
file was reviewed), and the authoring turn's own design utterance, which sits
in this session's history if the definition was authored here (it is the
claim under review, not evidence for it — judge against the material's text
and the definition's files, never against what the author said they did).

**Identify the units.** By default one material file is one unit: its H1 is
the title, and a `> **ID** …` line beneath it, when the collection carries
one, is the id — carry both into the row. A file that bundles several
separately triggered pieces (each with its own trigger, its own output, or
its own date on the schedule) yields several rows carrying the same path,
one per piece. A file under `deprecated/`, or one whose own text marks it as
no longer in force, is `retired-in-material` — a unit the definition may
legitimately leave out, and reporting its absence as a gap is a finding the
author refutes from the source you read. A file that names a unit and
carries no procedure (a status stub, a heading with nothing under it) is
`stub-in-material` — neither retired nor a drop, and not to be counted as
either.

**Judge, in this order.**

- Forward trace, material → definition. For each unit, find where the
  definition performs it — the intent whose criterion and procedure carry it,
  quoted — and give it one verdict: `carried` (one unit, one intent);
  `merged→{id}` (this unit and others perform as one intent — name it);
  `split→{ids}` (this unit became several intents — name them); `changed`
  (carried, but the definition alters what the material states: a threshold,
  an order of steps, an exception generalized away, an open question resolved
  silently — the `note` says what changed); `dropped` (no intent performs it —
  the `evidence` cell carries the authoring report's stated reason when there
  is one, or `no reason recorded`); `retired-in-material`; `stub-in-material`.
  "That step is performed by a person" is never the reason a unit is absent —
  it is true of nearly every step in a procedure, including the ones the
  intents you just passed do serve, whose deliverable is the request the
  human step consumes.
- The claim column, per row: `claimed` when the authoring report's Mapping as
  built names this unit and its row agrees with your verdict; `misclaimed`
  when it names the unit and disagrees (says merged where you found dropped,
  names an intent that does not carry it); `not-claimed` when the mapping has
  no row for it. A unit in neither column of the mapping is not a scoping
  decision the reader can see — it reads as complete coverage, which is why
  this column exists.
- Reverse trace, definition → material. Walk every intent, every rule in
  `base/` prose, every `on-demand/` file, and find the unit it comes from.
  Content with no source — a procedure the material never describes, a rule
  invented to fill a gap, a counterpart the material never names — is
  `unsourced`, and each is a finding: the authoring contract forbids the
  material's design authority in one direction and the author's invention in
  the other.
- The authoring report's claims. One row per Mapping as built row and per line
  under Hook decisions and Deliverable contracts: `holds` when the definition
  and the material bear it out, `fails` when either contradicts it (a
  "consumed by" no consumer's inputs declare; a "no hooks" on an intent whose
  procedure names a stable output path), `unverifiable` when nothing you can
  read decides it — with the evidence, not a restatement of the claim.
- Form coverage. When the material repeats a form — the same headings file
  after file — list those headings once from any file and confirm the
  frequency with `search_files`. A heading answered in most files and carried
  by no intent is a systematic drop the unit count cannot show, because every
  unit is present. One heading class is correctly dropped by the authoring
  contract itself: cadence, calendars and run order, which belong to pipeline
  authoring — record that as `correctly dropped (cadence → pipeline)`, not as
  a gap.
- The definition on its own terms: run `on-demand/audit.md` in full — the
  prose sweep, the dependency-report field rules, the intents' outcomes and
  the run-order quarantine, the altitude axes, hook coverage — and land what
  it finds under `## Findings`. That checklist is the definition-internal half
  of this review; the trace above is the other half, and neither substitutes
  for the other.

**Write the review report.**

- Every review turn writes the report in artifacts with `create_file`, whole,
  under `review-report/`: `review-report/{agentId}.md` on the first review of
  this agent, and when a report from an EARLIER session already exists there
  — a record the user may already be acting on, never overwrite it — a new
  `review-report/{agentId}-{mnemonic}.md`, the mnemonic a short kebab slug
  naming this round (`after-coverage-fix`, `second-pass`). Within one session,
  keep rewriting the file this session created. The newest `{agentId}*` file
  is the current review; readers go by file time, so no date belongs in the
  name. Read the newest existing one first: where its findings still hold,
  say so; where the definition has moved, say what closed.
- Structure is FIXED so a later turn and a script can find rows in place:
  headings, column names, the invariant line and the verdict and claim
  vocabularies below are structural tokens — never localized, never renamed.
  The prose in cells and findings follows the language the requester writes
  in. Column one of the trace is the material path RELATIVE to the attached
  directory, exactly as `list_files` listed it, so the listing and the table
  can be diffed mechanically.

  ```markdown
  # Review Report — {agent name} ({agentId})

  material: {attached path} · files listed: N · units: M · deprecated: D
  definition: _agents/{agentId} · authoring report: {path | none found}

  ## Trace

  files listed: N · rows: M · files without a row: 0

  | material path | unit (title · id) | verdict | destination | claim | evidence | note |
  |---|---|---|---|---|---|---|
  | {path/from/listing.md} | {H1 · ID} | carried | {jobId}/{intentId} | claimed | {definition path: "quoted phrase"} | |
  | {path} | {H1} | merged→{intentId} | {jobId}/{intentId} | misclaimed | {mapping row says split} | |
  | {path} | {H1} | dropped | — | not-claimed | no reason recorded | |
  | {deprecated/path} | {H1} | retired-in-material | — | not-claimed | {the marker} | |

  verdict: carried | merged→{id} | split→{ids} | changed | dropped | retired-in-material | stub-in-material
  claim: claimed | not-claimed | misclaimed

  ## Reverse trace

  | definition location | content | source | verdict |
  |---|---|---|---|
  | {file or jobId/intentId} | {one phrase} | {material path | none} | sourced | unsourced |

  ## Authoring report claims

  | claim | verdict | evidence |
  |---|---|---|
  | {quoted row or line} | holds | fails | unverifiable | {what decides it} |

  ## Form coverage

  | form heading | files answering | carried by | verdict |
  |---|---|---|---|
  | {heading as the material writes it} | {n}/{N} | {jobId/intentId | —} | covered | systematic drop | correctly dropped (cadence → pipeline) |

  ## Findings

  1. {file or row} — {the rule unmet} — {evidence}

  ## Judgment calls

  - {a defensible choice} — {its cost}
  ```

- Findings and judgment calls stay apart: a finding is a contract mechanism
  unmet, a unit no intent performs, a claim that fails, content with no
  source; a judgment call is a choice the contract permits whose cost is worth
  naming. Never conclude that a definition covers its material while a
  `dropped` or `unsourced` row stands unexplained — count it.

**Close with the chat report.** Emit the turn's `<checklist>` before the
first read (enumerate, forward trace, reverse trace, claims, form coverage,
audit, write) — a review's deliverables are several, and work missing from
the list is work that gets skipped. The reply gives the counts (files listed,
rows, the verdict tally), names the report's path, and lists the findings
that most change what the user does next. A review turn has always written
the report, so a reply with no `review-report/` line is a forgotten one,
never an exempt one.

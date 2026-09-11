**What this turn produces, and what it does not.** One file: the review
report, written into this project's artifacts under `review-report/`. Nothing
else changes — no definition save, no corrected draft, no proposed step edits
written anywhere to show them. The standard you judge against is the
authoring contract, `intents/build/prompt.md`, read on this turn when it is
not inlined; the evidence is the saved definition, the agents it runs, the
material whose cadence it automates, and the runs it has had. When the user
wants the findings turned into edits, that is a `@plan` turn of the authoring
intent, and the plan card carries it there. Your reply is the summary; the
report is the deliverable.

**Locate the inputs before reading any of them closely.**

- The pipeline: the `_pipelines/{pipelineId}/pipeline.yaml` the turn
  attached, else `read_file` it by id — `GET /definitions/pipelines/{id}`
  returns the same definition as `def`. A flow that split into several
  pipelines is reviewed as one flow: read every pipeline the report's Flow
  section names.
- The agents: `_agents/{agentId}/…` for every agent a step runs — the job,
  the pinned intent's `infer.md`, `prompt.md` and `hooks.yaml`, and the
  operating-context section at the end of each intent's prompt, which is the
  cadence knowledge this pipeline was supposed to read.
- The material: the directory the turn attached — the domain's schedule and
  order documents and the per-unit cadence statements (when a unit starts,
  what it waits on, how often). The band's hint to "read only what you need"
  does not apply to a review.
- The authoring report: the `pipeline-report/*.md` whose Flow section names
  this pipeline. Its absence on a pipeline authored here is a finding,
  recorded and then worked around: the trace still runs, with every `claim`
  cell reading `not-claimed`.
- The runs: `list_files pipeline-runs/` in this project's artifacts, and the
  newest `{runId}.jsonl` of this pipeline when one exists. "Never run" is a
  claim like any other — make it only from a listing you performed.
- When the pipeline or its agents are not in hand and nothing in the turn
  says where they are, ask through clarify — one question naming what is
  missing — and stop. A review against memory is not a review.

**Enumerate before judging.** `list_files` the material directory
recursively and record the count; that listing is the floor under the trace,
and the report's invariant line says so in numbers (`files listed: N · rows:
M · files without a row: 0`). Read every file first-hand on this turn. The
already-read manifest and the authoring turn's design utterance, both
possibly in this session's history, are not evidence — the first says a file
was read for another purpose, the second is the claim under review.

**Identify the units.** A unit here is a claim the material makes about WHEN
and AFTER WHAT work happens: a cadence (a date, a weekday, a frequency), an
order (this after that), a hand-off (a third party's reply, a person's
approval, a file that arrives), a condition on which a step runs. One
material file usually carries several; a schedule document carries one per
row. A file that carries none — a procedure with no cadence statement — still
gets one row, verdict `no-cadence-claim`, so the invariant holds. Files under
`deprecated/` are `retired-in-material`.

**Judge, in this order.**

- Forward trace, material → pipeline. For each unit, find where the flow
  honours it and give it one verdict: `carried` (a trigger, a step, a gate,
  a relay or a boundary honours it as stated — the `destination` names which:
  `trigger`, `{pipelineId}/{stepId}`, `gate:{stepId}`, `relay`, `boundary`);
  `merged→{stepId}` (several material steps run as one step's intent — name
  it); `split→{stepIds}`; `changed` (honoured differently from what the
  material states: a lead time shortened, a hand-off turned into a fixed
  date, a condition read off a different axis than the material conditions
  on — the `note` says what changed); `dropped` (nothing in the flow honours
  it, the `evidence` carrying the report's stated reason or `no reason
  recorded`); `retired-in-material`; `no-cadence-claim`.
- The claim column, per row: `claimed` when the authoring report names this
  unit (in Flow, Seams, Relays, Substitutes or Left to a person) and agrees
  with your verdict; `misclaimed` when it names it and disagrees;
  `not-claimed` when no section does.
- Reverse trace, pipeline → material. Every trigger, step, edge condition,
  gate, pin and directive sentence: which material unit does it come from? A
  step conditioned on an axis the material does not condition on, a gate the
  material has no decision for, a directive asserting an event the material
  never describes — each is `unsourced`, and each is a finding.
- The authoring report's claims, section by section. One row per Flow entry,
  Seam, Relay, Substitute, Intent change, Outcome coverage line, Run entry
  line and Left-to-a-person line: `holds`, `fails` (the definition's own
  `context`, `needs`, `on` and `directive` fields contradict it — a pin the
  report describes that no step carries; a seam the report calls a gate that
  the definition runs through), or `unverifiable`. Check Outcome coverage by
  simulation: walk the graph once per declared outcome and compare the steps
  that skip with what the section claims.
- Definition-internal checks: run `on-demand/audit.md` in full — every named
  mechanism left unused, the seam classification, the pins, the directives,
  the chain-context rule — and land what it finds under `## Findings`. Route
  each finding to the surface that owns it: what a step DOES is the agent's
  definition (the Agent Builder's lane); when it runs and what follows is
  this lane.

**Write the review report.**

- Every review turn writes the report in artifacts with `create_file`, whole,
  under `review-report/`: `review-report/{pipelineId}-pipeline.md` on the
  first review (the suffix keeps the directory shared with agent reviews
  collision-free — an agent and a pipeline may carry the same id), and when a
  report from an EARLIER session already exists there — never overwrite a
  record the user may be acting on — a new
  `review-report/{pipelineId}-pipeline-{mnemonic}.md`, the mnemonic a short
  kebab slug naming this round. Within one session, keep rewriting the file
  this session created; the newest is current, so no date belongs in the
  name. A flow of several pipelines takes the flow's shared id stem as its
  `{pipelineId}`.
- Structure is FIXED: headings, column names, the invariant line and the
  vocabularies are structural tokens — never localized, never renamed. Prose
  in cells and findings follows the requester's language. Column one of the
  trace is the material path RELATIVE to the attached directory, exactly as
  `list_files` listed it.

  ```markdown
  # Review Report — {flow or pipeline name} ({pipelineId})

  material: {attached path} · files listed: N · units: M · deprecated: D
  pipelines: {pipelineId}, … · authoring report: {path | none found} · runs read: {runId | none}

  ## Trace

  files listed: N · rows: M · files without a row: 0

  | material path | unit (cadence · order · hand-off) | verdict | destination | claim | evidence | note |
  |---|---|---|---|---|---|---|
  | {path/from/listing.md} | {the claim, one phrase} | carried | {pipelineId}/{stepId} | claimed | {field: "quoted"} | |
  | {path} | {claim} | changed | trigger | misclaimed | {cron vs the material's date} | {what changed} |
  | {path} | {claim} | dropped | — | not-claimed | no reason recorded | |

  verdict: carried | merged→{stepId} | split→{stepIds} | changed | dropped | retired-in-material | no-cadence-claim
  claim: claimed | not-claimed | misclaimed
  destination: trigger | {pipelineId}/{stepId} | gate:{stepId} | relay | boundary

  ## Reverse trace

  | definition location | content | source | verdict |
  |---|---|---|---|
  | {pipelineId}/{stepId}.{field} | {one phrase} | {material path | none} | sourced | unsourced |

  ## Authoring report claims

  | section | claim | verdict | evidence |
  |---|---|---|---|
  | {Flow | Seams | Relays | Substitutes | Intent changes | Outcome coverage | Run entry | Left to a person} | {quoted} | holds | fails | unverifiable | {what decides it} |

  ## Findings

  1. {pipelineId/stepId or row} — {the mechanism unmet} — {evidence} → {this lane | Agent Builder}

  ## Judgment calls

  - {a defensible choice} — {its cost}
  ```

- Findings and judgment calls stay apart. Never conclude that a flow honours
  its material while a `dropped` or `unsourced` row stands unexplained —
  count it.

**Close with the chat report.** Emit the turn's `<checklist>` before the
first read (enumerate, forward trace, reverse trace, claims, audit, write).
The reply gives the counts, names the report's path, and lists the findings
that most change what the user does next — those routed to the Agent Builder
named as such. A review turn has always written the report, so a reply with
no `review-report/` line is a forgotten one, never an exempt one.

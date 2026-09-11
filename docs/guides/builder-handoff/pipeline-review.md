# Handoff — pipeline-builder / review, performed offline

## What this is

The `review` intent of the shipped `pipeline-builder` judges a saved flow
against the agents it runs, the material whose cadence it automates, and the
authoring contract, and leaves one deliverable: the review report. Offline, in
a fresh context, it is the independent review. This file maps the intent's
runtime channels to a working tree; the contract is the intent's prose.

## Read, in this order

Reading a bundle? These files follow verbatim under "Part 2 — Contract files",
in this order; the paths below are where a clone keeps them. Either way, read
every file in full before designing.

1. `packages/ant-cli/src/core/data/agents/pipeline-builder/base/role.md`
2. `packages/ant-cli/src/core/data/agents/pipeline-builder/jobs/author/base/system.md`
3. `packages/ant-cli/src/core/data/agents/pipeline-builder/jobs/author/job.yaml`
4. `packages/ant-cli/src/core/data/agents/pipeline-builder/jobs/author/intents/review/infer.md`
   and `packages/ant-cli/src/core/data/agents/pipeline-builder/jobs/author/intents/review/prompt.md`
   — the review procedure and the report skeleton.
5. `packages/ant-cli/src/core/data/agents/pipeline-builder/jobs/author/intents/review/hooks.yaml`
6. `packages/ant-cli/src/core/data/agents/pipeline-builder/on-demand/audit.md` —
   the per-step mechanism checks, run in full.
7. The standard you judge against:
   `packages/ant-cli/src/core/data/agents/pipeline-builder/jobs/author/intents/build/prompt.md`,
   with `packages/ant-cli/src/core/data/agents/pipeline-builder/on-demand/pipeline-format.md`
   and `packages/ant-cli/src/core/data/agents/pipeline-builder/on-demand/api-surface.md`.
8. Listed so the read-list is the whole definition:
   `packages/ant-cli/src/core/data/agents/pipeline-builder/jobs/author/intents/build/infer.md`,
   `packages/ant-cli/src/core/data/agents/pipeline-builder/jobs/author/intents/build/hooks.yaml`.

## Working tree

No layout is prescribed. Work where the person says; when nobody says, make a
fresh folder OUTSIDE any Ant clone, so nothing you write lands in a git
working tree. Two names bind:

- **the report is `review-report/{pipelineId}-pipeline.md`**, or its
  `-pipeline-{mnemonic}.md` revision when an earlier review was handed to you;
- **its Trace table's first column is the material path relative to the
  material folder's root**, because `check-review` diffs that column against a
  real listing.

You were given, wherever the person put them: every pipeline of the flow, the
agents its steps run, the flow's authoring report, the material (the WHOLE
folder), any run logs the person exported, and any earlier reviews. Write
nothing back into them.

## Channel substitution table

| Runtime instruction (where in the prose) | Offline equivalent | Same validator? |
|---|---|---|
| attached `_pipelines/{pipelineId}/pipeline.yaml`; `GET /definitions/pipelines/{id}`; `GET /definitions/pipelines` | the pipeline definitions you were given | n/a |
| `_agents/{agentId}/…`; `GET /definitions/agents`, `GET /definitions/agents/{agentId}/files` | the agent definitions you were given; builtins from the clone or the bundle's Part 2 | n/a |
| the attached material directory; "Enumerate before judging" | `find <the material> -name '*.md' \| sort` — the row floor; read every file | yes — `check-review` |
| `pipeline-report/*.md` whose Flow section names the pipeline | `grep -l '^## Flow' <the authoring reports>` and read the one naming it; its absence is a finding | n/a |
| `list_files pipeline-runs/` and the newest run | the exported run logs, when you were given them; otherwise record "runs: not available offline" — never "never run" | n/a |
| `create_file review-report/{pipelineId}-pipeline.md` | write `review-report/{pipelineId}-pipeline.md`; with an earlier review in hand, write the `-pipeline-{mnemonic}.md` revision | partly — `check-review` verifies coverage |
| the definition-internal checks that need the API (`GET /definitions/pipelines/{id}/permissions`, `GET /definitions/pipelines/activatable-projects`, `POST /definitions/pipelines/preview-fires`) | `pnpm --filter @ant/cli definition validate-pipeline <the pipeline.yaml> --agents <the agent folders>` and `pnpm --filter @ant/cli definition preview-fires "<cron>" --tz <zone>` for the trigger's fires; permissions and projects are not review evidence | yes |
| clarify — the pipeline or its agents are not in hand | ask before writing | n/a |
| `read_ant_source`, `list_ant_files`, `search_ant_code` | the clone | n/a |

## Bring it in

Upload `review-report/{pipelineId}-pipeline.md` into the project's Artifacts
panel under `review-report/`.

## Done when

The builtin's `hooks.yaml` for this intent carries one stop hook,
`review-report/*.md`, with the default arm (always). Offline that is:

- `review-report/{pipelineId}-pipeline.md` exists and follows the skeleton in
  `review/prompt.md`, invariant line `files without a row: 0`;
- `pnpm --filter @ant/cli definition check-review <the report> <the material>`
  exits `0`;
- your reply gives the counts, the report's path, and the findings routed to
  the lane that owns each (this one, or the Agent Builder).

Change nothing else — no edited definition, no corrected draft.

Without a clone there is no validator to run: deliver, let the person import,
and treat the `validation` lines the import answers as the findings to fix.

## Out of scope offline

Run history is evidence only when the person exports it. The write routes in
the definition's `on-demand/api-surface.md` (`POST /definitions/pipelines`,
`PUT /definitions/pipelines/{id}`, `DELETE /definitions/pipelines/{id}`)
belong to the build intent.

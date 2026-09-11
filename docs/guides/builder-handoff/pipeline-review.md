# Handoff — pipeline-builder / review, performed offline

## What this is

The `review` intent of the shipped `pipeline-builder` judges a saved flow
against the agents it runs, the material whose cadence it automates, and the
authoring contract, and leaves one deliverable: the review report. Offline, in
a fresh context, it is the independent review. This file maps the intent's
runtime channels to a working tree; the contract is the intent's prose, inlined
as Part 2 of this bundle.

## Read, in this order

Each path below is a `## FILE:` heading in Part 2, in this order — walk Part 2
from top to bottom and you have read the list. (A clone at the server's commit
keeps the same bytes at the same paths.) Read every file in full before
designing.

1. `packages/ant-cli/src/core/data/agents/pipeline-builder/base/role.md`
2. `packages/ant-cli/src/core/data/agents/pipeline-builder/jobs/author/base/system.md`
3. `packages/ant-cli/src/core/data/agents/pipeline-builder/jobs/author/job.yaml`
4. `packages/ant-cli/src/core/data/agents/pipeline-builder/jobs/author/intents/review/infer.md`
   — the criterion that selects this intent.
5. `packages/ant-cli/src/core/data/agents/pipeline-builder/jobs/author/intents/review/prompt.md`
   — the review procedure and the report skeleton.
6. `packages/ant-cli/src/core/data/agents/pipeline-builder/jobs/author/intents/review/hooks.yaml`
7. `packages/ant-cli/src/core/data/agents/pipeline-builder/on-demand/api-surface.md`
   — the route facts the authoring contract relies on.
8. `packages/ant-cli/src/core/data/agents/pipeline-builder/on-demand/audit.md` —
   the per-step mechanism checks, run in full.
9. `packages/ant-cli/src/core/data/agents/pipeline-builder/on-demand/pipeline-format.md`
   — the grammar you judge each definition against.
10. The standard you judge by — the build intent's own instructions. Its
    criterion and hook are listed so the read-list is the whole definition:
    `packages/ant-cli/src/core/data/agents/pipeline-builder/jobs/author/intents/build/infer.md`,
    `packages/ant-cli/src/core/data/agents/pipeline-builder/jobs/author/intents/build/prompt.md`,
    `packages/ant-cli/src/core/data/agents/pipeline-builder/jobs/author/intents/build/hooks.yaml`.

## Working tree

No layout is prescribed. Work where the person says; when nobody says, make a
fresh folder OUTSIDE any Ant clone, so nothing you write lands in a git
working tree. Two names bind:

- **the report is `review-report/{pipelineId}-pipeline.md`**, or its
  `-pipeline-{mnemonic}.md` revision when an earlier review was handed to you;
- **its Trace table's first column is the material path relative to the
  material folder's root**, so that column and a listing of the material folder
  compare line for line — that comparison is the coverage count you report, and
  `check-review` mechanises it for anyone holding a clone.

You were given, wherever the person put them: every pipeline of the flow, the
agents its steps run, the flow's authoring report, the material (the WHOLE
folder), any run logs the person exported, and any earlier reviews. Write
nothing back into them.

## Channel substitution table

"Same validator?" means the same server functions judge your work either way:
with a clone you run them yourself, without one the import runs them as it
accepts the folder. A cell that names a clone-only command says so.

| Runtime instruction (where in the prose) | Offline equivalent | Same validator? |
|---|---|---|
| attached `_pipelines/{pipelineId}/pipeline.yaml`; `GET /definitions/pipelines/{id}`; `GET /definitions/pipelines` | the pipeline definitions you were given | n/a |
| `_agents/{agentId}/…`; `GET /definitions/agents`, `GET /definitions/agents/{agentId}/files` | the agent definitions you were given; the builders' own are Part 2 | n/a |
| the attached material directory; "Enumerate before judging" | `find <the material> -name '*.md' \| sort` — the row floor; read every file. That listing IS the check: one Trace row per line of it | with a clone, `check-review` diffs the two for you |
| `pipeline-report/*.md` whose Flow section names the pipeline | `grep -l '^## Flow' <the authoring reports>` and read the one naming it; its absence is a finding | n/a |
| `list_files pipeline-runs/` and the newest run | the exported run logs, when you were given them; otherwise record "runs: not available offline" — never "never run" | n/a |
| `create_file review-report/{pipelineId}-pipeline.md` | write `review-report/{pipelineId}-pipeline.md`; with an earlier review in hand, write the `-pipeline-{mnemonic}.md` revision | you are the checker: diff your Trace table's first column against the listing you made, and state the count. With a clone, `check-review` mechanises that same check |
| the definition-internal checks that need the API (`GET /definitions/pipelines/{id}/permissions`, `GET /definitions/pipelines/activatable-projects`, `POST /definitions/pipelines/preview-fires`) | without a clone, judge the trigger as written — the cron expression against the cadence the material calls for — and never compute fire times yourself; record that the fires themselves are what Ant's Pipelines tab shows. With a clone, `pnpm --filter @ant/cli definition validate-pipeline <the pipeline.yaml> --agents <the agent folders>` and `pnpm --filter @ant/cli definition preview-fires "<cron>" --tz <zone>`. Permissions and projects are not review evidence in either mode | with a clone, yes |
| clarify — the pipeline or its agents are not in hand | ask before writing | n/a |
| `read_ant_source`, `list_ant_files`, `search_ant_code` | nothing to substitute, and nothing you need: Part 2 is the whole standard you judge against. If you believe you need Ant's source, stop and say so rather than improvising (with a clone: `packages/ant-cli/src/**`, `docs/**`) | n/a |

## Bring it in

Upload `review-report/{pipelineId}-pipeline.md` into the project's Artifacts
panel under `review-report/`.

## Done when

The builtin's `hooks.yaml` for this intent carries one stop hook,
`review-report/*.md`, with the default arm (always). Offline that is:

- `review-report/{pipelineId}-pipeline.md` exists and follows the skeleton in
  `review/prompt.md`, and you have checked its invariant line yourself:
  `files without a row: 0`, by diffing the Trace table's first column against
  the material listing you made. That diff is the floor and needs no tools
  beyond the ones you already used;
- with a clone,
  `pnpm --filter @ant/cli definition check-review <the report> <the material>`
  exits `0` — the same coverage check, mechanised. Without a clone your own
  diff is the whole of it;
- your reply gives the counts, the report's path, and the findings routed to
  the lane that owns each (this one, or the Agent Builder).

Change nothing else — no edited definition, no corrected draft.

Nothing validates a review for you. The report goes into the Artifacts panel as
a file, and no loader reads it — so the coverage count you state is the only
check there is. Say plainly which rows you could not source rather than
rounding the count.

## Out of scope offline

Run history is evidence only when the person exports it, and fire times are
clone-only — judge the cron expression, not a computed schedule. Browsing
Ant's own source is unavailable and unnecessary — Part 2 is the contract. The write routes in
the definition's `on-demand/api-surface.md` (`POST /definitions/pipelines`,
`PUT /definitions/pipelines/{id}`, `DELETE /definitions/pipelines/{id}`)
belong to the build intent.

# Handoff — pipeline-builder / review, performed offline

## What this is

The `review` intent of the shipped `pipeline-builder` judges a saved flow
against the agents it runs, the material whose cadence it automates, and the
authoring contract, and leaves one deliverable: the review report. Offline, in
a fresh context, it is the independent review. This file maps the intent's
runtime channels to a working tree; the contract is the intent's prose.

## Read, in this order

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

```
in/pipelines/{pipelineId}/pipeline.yaml        every pipeline of the flow under review
in/agents/{agentId}/…                          every agent a step runs
in/artifacts/pipeline-report/…                 the flow's authoring report
in/artifacts/pipeline-runs/…                   run logs, when the person exports them ({runId}.jsonl, index.jsonl)
in/artifacts/review-report/…                   earlier reviews, when any
in/material/…                                  the procedure's schedule and order documents — the WHOLE folder
out/artifacts/review-report/{pipelineId}-pipeline.md
```

## Channel substitution table

| Runtime instruction (where in the prose) | Offline equivalent | Same validator? |
|---|---|---|
| attached `_pipelines/{pipelineId}/pipeline.yaml`; `GET /definitions/pipelines/{id}`; `GET /definitions/pipelines` | `in/pipelines/*/pipeline.yaml` | n/a |
| `_agents/{agentId}/…`; `GET /definitions/agents`, `GET /definitions/agents/{agentId}/files` | `in/agents/{agentId}/…`, builtins from the clone | n/a |
| the attached material directory; "Enumerate before judging" | `find in/material -name '*.md' \| sort` — the row floor; read every file | yes — `check-review` |
| `pipeline-report/*.md` whose Flow section names the pipeline | `grep -l '^## Flow' in/artifacts/pipeline-report/*.md` and read the one naming it; its absence is a finding | n/a |
| `list_files pipeline-runs/` and the newest run | `in/artifacts/pipeline-runs/`, when exported; otherwise record "runs: not available offline" — never "never run" | n/a |
| `create_file review-report/{pipelineId}-pipeline.md` | write `out/artifacts/review-report/{pipelineId}-pipeline.md`; with an earlier one in `in/artifacts/review-report/`, write the `-pipeline-{mnemonic}.md` revision | partly — `check-review` verifies coverage |
| the definition-internal checks that need the API (`GET /definitions/pipelines/{id}/permissions`, `GET /definitions/pipelines/activatable-projects`, `POST /definitions/pipelines/preview-fires`) | `pnpm --filter @ant/cli definition validate-pipeline in/pipelines/{pipelineId}/pipeline.yaml --agents in/agents` and `pnpm --filter @ant/cli definition preview-fires "<cron>" --tz <zone>` for the trigger's fires; permissions and projects are not review evidence | yes |
| clarify — the pipeline or its agents are not in hand | ask before writing | n/a |
| `read_ant_source`, `list_ant_files`, `search_ant_code` | the clone | n/a |

## Bring it in

Upload `out/artifacts/review-report/{pipelineId}-pipeline.md` into the
project's Artifacts panel under `review-report/`.

## Done when

The builtin's `hooks.yaml` for this intent carries one stop hook,
`review-report/*.md`, with the default arm (always). Offline that is:

- `out/artifacts/review-report/{pipelineId}-pipeline.md` exists and follows the
  skeleton in `review/prompt.md`, invariant line `files without a row: 0`;
- `pnpm --filter @ant/cli definition check-review out/artifacts/review-report/{pipelineId}-pipeline.md in/material`
  exits `0`;
- your reply gives the counts, the report's path, and the findings routed to
  the lane that owns each (this one, or the Agent Builder).

Change nothing else — no edited definition, no corrected draft.

## Out of scope offline

Run history is evidence only when the person exports it. The write routes in
the definition's `on-demand/api-surface.md` (`POST /definitions/pipelines`,
`PUT /definitions/pipelines/{id}`, `DELETE /definitions/pipelines/{id}`)
belong to the build intent.

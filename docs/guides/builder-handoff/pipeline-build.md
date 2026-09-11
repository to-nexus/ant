# Handoff — pipeline-builder / build, performed offline

## What this is

The shipped `pipeline-builder` definition is the contract for composing a
trigger and a step chain over agents that already exist; this file maps its
runtime channels to a working tree. Read the contract from a clone at the
server's commit (see `docs/guides/builder-handoff/README.md`), author in
`out/`, and hand back what the builtin owes: one `pipeline.yaml` per pipeline
of the flow and one run report for the flow.

## Read, in this order

1. `packages/ant-cli/src/core/data/agents/pipeline-builder/base/role.md`
2. `packages/ant-cli/src/core/data/agents/pipeline-builder/jobs/author/base/system.md`
   — the five-step procedure; step 2 is where the agents' operating-context
   sections become the schedule's requirements.
3. `packages/ant-cli/src/core/data/agents/pipeline-builder/jobs/author/job.yaml`
4. `packages/ant-cli/src/core/data/agents/pipeline-builder/jobs/author/intents/build/infer.md`
   and `packages/ant-cli/src/core/data/agents/pipeline-builder/jobs/author/intents/build/prompt.md`
   — the whole authoring contract: seams, relays, boundaries, pins, the
   eight-section run report.
5. `packages/ant-cli/src/core/data/agents/pipeline-builder/jobs/author/intents/build/hooks.yaml`
6. `packages/ant-cli/src/core/data/agents/pipeline-builder/on-demand/pipeline-format.md`
   — the definition grammar; every yaml fence in it passes the real save gate.
7. `packages/ant-cli/src/core/data/agents/pipeline-builder/on-demand/api-surface.md`
8. `packages/ant-cli/src/core/data/agents/pipeline-builder/on-demand/audit.md`
9. The standard your output is later judged by:
   `packages/ant-cli/src/core/data/agents/pipeline-builder/jobs/author/intents/review/prompt.md`,
   with its criterion and hook
   `packages/ant-cli/src/core/data/agents/pipeline-builder/jobs/author/intents/review/infer.md`,
   `packages/ant-cli/src/core/data/agents/pipeline-builder/jobs/author/intents/review/hooks.yaml`.

A worked example: `examples/pipelines/weekly-ops.yaml`, which runs
`examples/custom-agents/ops-team`.

## Working tree

```
in/agents/{agentId}/…                          every agent a step runs (downloaded zips; builtins from the clone)
in/pipelines/{pipelineId}/pipeline.yaml        pipelines you were asked to edit (rail download, unzipped)
in/artifacts/dependency-report/{agentId}*.md   each agent's report — the human relays live there
in/artifacts/pipeline-report/…                 the flow's earlier report, when editing
in/material/…                                  the procedure and its schedule
out/pipelines/{pipelineId}/pipeline.yaml       one folder per pipeline — folder name = id on import
out/artifacts/pipeline-report/{flowId}.md
```

## Channel substitution table

| Runtime instruction (where in the prose) | Offline equivalent | Same validator? |
|---|---|---|
| attached `_pipelines/{pipelineId}/pipeline.yaml`, `_agents/{agentId}/…`; `GET /definitions/pipelines/{id}` (`base/system.md` step 1) | `in/pipelines/{pipelineId}/pipeline.yaml`, `in/agents/{agentId}/…` | n/a |
| `GET /definitions/pipelines` — ids are taken across scopes | `ls in/pipelines/`; the final collision check is the import's `409` | n/a |
| `GET /definitions/agents`, `GET /definitions/agents/{agentId}/files` — resolve every step against a real job and intent (step 2) | `ls in/agents/` and `packages/ant-cli/src/core/data/agents/`; read each `jobs/{jobId}/intents/{intentId}/` | yes — `validate-pipeline --agents in/agents` binds every step against that catalog |
| `POST /definitions/pipelines` `{ id?, def }`, `PUT /definitions/pipelines/{id}` `{ def }` (step 4) | write `out/pipelines/{pipelineId}/pipeline.yaml` — YAML of the same `def`, `version: 2`; mint the id yourself, the folder name is the id on import | yes — `validatePipelineDefServer`, same `errors[]` |
| `DELETE /definitions/pipelines/{id}` | delete the folder | n/a |
| `POST /definitions/pipelines/preview-fires` `{ cron, tz? }` — the only cron authority | `pnpm --filter @ant/cli definition preview-fires "<cron>" --tz <zone>` — same parser, same five-minute floor; never compute fire times yourself | yes |
| `400` `errors[]`, `201` `catalogWarnings` | `pnpm --filter @ant/cli definition validate-pipeline out/pipelines/{pipelineId}/pipeline.yaml --agents in/agents` — `error:` lines are the 400, `warning:` lines are the save warnings that hard-fail enable later; `--strict` makes them exit `1` | yes |
| `GET /definitions/pipelines/activatable-projects`, `GET /definitions/pipelines/{id}/permissions` | none offline — the hand-over names no project unless the person gives you the list | n/a |
| `create_file pipeline-report/{flowId}.md` ("Write the run report") | write `out/artifacts/pipeline-report/{flowId}.md` from the definitions you wrote, read back; an edit turn reads `in/artifacts/pipeline-report/` first and rewrites the flow's file whole | n/a |
| clarify — a step needs an agent, job or intent that does not exist | stop and ask; do not invent a step. The missing work is the agent-build handoff's | n/a |
| `read_ant_source`, `list_ant_files`, `search_ant_code` | the clone | n/a |

## Bring it in

Pipelines rail → upload → pick `out/pipelines/{pipelineId}/pipeline.yaml`
(or the folder). A `409` offers to replace a pipeline you own while it is
disabled. Every saved pipeline is a disabled draft: enabling it and activating
it on a project are the person's steps, in the Pipelines tab. Then upload
`out/artifacts/pipeline-report/{flowId}.md` into the project's Artifacts
panel under `pipeline-report/`.

## Done when

The builtin's `hooks.yaml` for this intent reads `arm: on-write` with two stop
hooks, `api__ant__request POST|PUT /definitions/pipelines**` and
`pipeline-report/*.md`. Offline that is:

- at least one `out/pipelines/{pipelineId}/pipeline.yaml` exists and
  `pnpm --filter @ant/cli definition validate-pipeline` on each exits `0`
  with the agents it runs passed through `--agents`;
- `out/artifacts/pipeline-report/{flowId}.md` exists with all eight sections;
- your reply is the report-and-hand-over the contract describes: the trigger
  with its next fires, each step and what it runs, what remains a person's
  decision.

## Out of scope offline

`activatable-projects` and `permissions` have no offline twin. `enable`,
`disable`, `activate`, `deactivate`, `run-now`, `promote`, `editors`,
`approvals`, `runs`, `download` and `import` are a person's routes in every
mode — the runtime builder is refused on them too.

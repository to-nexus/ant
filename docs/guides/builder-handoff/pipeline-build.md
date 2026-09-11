# Handoff — pipeline-builder / build, performed offline

## What this is

The shipped `pipeline-builder` definition is the contract for composing a
trigger and a step chain over agents that already exist; this file maps its
runtime channels to a working tree. The contract itself is Part 2 of this
bundle — read it there, in full — and hand back what the builtin owes: one
`pipeline.yaml` per pipeline of the flow and one run report for the flow.

## Read, in this order

Each path below is a `## FILE:` heading in Part 2, in this order — walk Part 2
from top to bottom and you have read the list. (A clone at the server's commit
keeps the same bytes at the same paths.) Read every file in full before
designing.

1. `packages/ant-cli/src/core/data/agents/pipeline-builder/base/role.md`
2. `packages/ant-cli/src/core/data/agents/pipeline-builder/jobs/author/base/system.md`
   — the five-step procedure; step 2 is where the agents' operating-context
   sections become the schedule's requirements.
3. `packages/ant-cli/src/core/data/agents/pipeline-builder/jobs/author/job.yaml`
4. `packages/ant-cli/src/core/data/agents/pipeline-builder/jobs/author/intents/build/infer.md`
   — the criterion that selects this intent.
5. `packages/ant-cli/src/core/data/agents/pipeline-builder/jobs/author/intents/build/prompt.md`
   — the whole authoring contract: seams, relays, boundaries, pins, the
   eight-section run report.
6. `packages/ant-cli/src/core/data/agents/pipeline-builder/jobs/author/intents/build/hooks.yaml`
7. `packages/ant-cli/src/core/data/agents/pipeline-builder/on-demand/api-surface.md`
8. `packages/ant-cli/src/core/data/agents/pipeline-builder/on-demand/audit.md`
9. `packages/ant-cli/src/core/data/agents/pipeline-builder/on-demand/pipeline-format.md`
   — the definition grammar; every yaml fence in it passes the real save gate.
10. The standard your output is later judged by:
    `packages/ant-cli/src/core/data/agents/pipeline-builder/jobs/author/intents/review/infer.md`,
    `packages/ant-cli/src/core/data/agents/pipeline-builder/jobs/author/intents/review/prompt.md`,
    `packages/ant-cli/src/core/data/agents/pipeline-builder/jobs/author/intents/review/hooks.yaml`.

## Working tree

No layout is prescribed. Three names bind; group the rest however suits you
and say in your closing report where things are.

- Work where the person says. When nobody says, make a fresh folder OUTSIDE
  any Ant clone, so nothing you write lands in a git working tree.
- **A pipeline folder's name IS the pipeline id on import**, and it holds one
  file: `{pipelineId}/pipeline.yaml`. A flow that splits is several such
  folders.
- **The run report is `pipeline-report/{flowId}.md`** — ONE file for the whole
  flow, however many pipelines it split into.

You were given, wherever the person put them: the agents the steps run, any
pipelines to edit, each agent's dependency report, the flow's earlier report
when editing, and the material. Write nothing back into them.

## Channel substitution table

"Same validator?" means the same server functions judge your work either way:
with a clone you run them yourself, without one the import runs them as it
accepts the folder. A cell that names a clone-only command says so.

| Runtime instruction (where in the prose) | Offline equivalent | Same validator? |
|---|---|---|
| attached `_pipelines/{pipelineId}/pipeline.yaml`, `_agents/{agentId}/…`; `GET /definitions/pipelines/{id}` (`base/system.md` step 1) | the pipeline and the agent definitions you were given | n/a |
| `GET /definitions/pipelines` — ids are taken across scopes | the pipelines you were given; the final collision check is the import's `409` | n/a |
| `GET /definitions/agents`, `GET /definitions/agents/{agentId}/files` — resolve every step against a real job and intent (step 2) | the agent definitions you were given — read each `jobs/{jobId}/intents/{intentId}/`; Part 2 holds the builders' own | with a clone, yes — `pnpm --filter @ant/cli definition validate-pipeline --agents <folder holding them>` binds every step against that catalog; without one, the upload does |
| `POST /definitions/pipelines` `{ id?, def }`, `PUT /definitions/pipelines/{id}` `{ def }` (step 4) | write `{pipelineId}/pipeline.yaml` — YAML of the same `def`, `version: 2`; mint the id yourself, the folder name is the id on import | yes — `validatePipelineDefServer`, same `errors[]` |
| `DELETE /definitions/pipelines/{id}` | delete the folder | n/a |
| `POST /definitions/pipelines/preview-fires` `{ cron, tz? }` — the only cron authority | never compute fire times yourself, in either mode. Without a clone you do not state them at all: give the cron expression and the cadence you intended in words, and record that the next fires are the ones Ant's Pipelines tab shows after upload. With a clone, `pnpm --filter @ant/cli definition preview-fires "<cron>" --tz <zone>` — same parser, same five-minute floor | with a clone, yes; otherwise deferred to the upload |
| `400` `errors[]`, `201` `catalogWarnings` | without a clone, the upload answers both: its response carries the errors and the catalog warnings, and those lines are your findings. With a clone, `pnpm --filter @ant/cli definition validate-pipeline <the pipeline.yaml> --agents <the agent folders>` — `error:` lines are the 400, `warning:` lines are the save warnings that hard-fail enable later; `--strict` makes them exit `1` | with a clone, yes; otherwise the upload |
| `GET /definitions/pipelines/activatable-projects`, `GET /definitions/pipelines/{id}/permissions` | none offline — the hand-over names no project unless the person gives you the list | n/a |
| `create_file pipeline-report/{flowId}.md` ("Write the run report") | write `pipeline-report/{flowId}.md` from the definitions you wrote, read back; an edit turn reads the flow's earlier report first and rewrites it whole | n/a |
| clarify — a step needs an agent, job or intent that does not exist | stop and ask; do not invent a step. The missing work is the agent-build handoff's | n/a |
| `read_ant_source`, `list_ant_files`, `search_ant_code` | nothing to substitute, and nothing you need: Part 2 is the whole contract for this job. If you believe you need Ant's source, stop and say so rather than improvising (with a clone: `packages/ant-cli/src/**`, `docs/**`) | n/a |

## Bring it in

Pipelines rail → upload → pick `{pipelineId}/pipeline.yaml` (or its folder).
A `409` offers to replace a pipeline you own while it is disabled. Every saved
pipeline is a disabled draft: enabling it and activating it on a project are
the person's steps, in the Pipelines tab. Then upload
`pipeline-report/{flowId}.md` into the project's Artifacts panel under
`pipeline-report/`.

## Done when

The builtin's `hooks.yaml` for this intent reads `arm: on-write` with two stop
hooks, `api__ant__request POST|PUT /definitions/pipelines**` and
`pipeline-report/*.md`. Offline that is:

- at least one `{pipelineId}/pipeline.yaml` exists, and every step of it
  resolves against an agent, job and intent you were actually given. With a
  clone, `pnpm --filter @ant/cli definition validate-pipeline` on each exits
  `0` with the agents it runs passed through `--agents`; without a clone the
  upload is that check — deliver, and treat the errors and catalog warnings its
  response carries as the findings to fix;
- `pipeline-report/{flowId}.md` exists with all eight sections;
- your reply is the report-and-hand-over the contract describes: the trigger
  and the cadence it encodes, each step and what it runs, what remains a
  person's decision. State the next fires only if you were able to have them
  computed; otherwise say where the person reads them.

## Out of scope offline

`activatable-projects` and `permissions` have no offline twin, and neither do
fire times without a clone. Browsing Ant's own source is unavailable and
unnecessary — Part 2 is the contract. `enable`,
`disable`, `activate`, `deactivate`, `run-now`, `promote`, `editors`,
`approvals`, `runs`, `download` and `import` are a person's routes in every
mode — the runtime builder is refused on them too.

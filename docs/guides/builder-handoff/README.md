# Builder handoffs — the same job, done by an external agent

Ant ships two builtin builders, `agent-builder` and `pipeline-builder`. Each
carries one job, `author`, with two intents: `build` (author or change a
definition, leave a report) and `review` (judge a finished definition against
the material it came from, leave a report). Their prose under
`packages/ant-cli/src/core/data/agents/` **is the contract** — the file
format, the design doctrine, the report skeletons, the completion hooks — and
it is executed against the real validators by
`packages/ant-cli/tests/customAgents/builtin-agents.test.ts`.

A frontier model in a coding agent on your laptop is often the better author.
The documents in this directory let it do exactly the builtin's job and hand
back exactly the builtin's deliverables, without a second copy of the
contract. **Each handoff carries only the channel deltas**: which repo files
to read, in what order, and what to do offline where the prose says "call the
API". Nothing in here restates a rule; if a handoff and the builtin prose ever
disagree, the prose wins and the handoff has a bug.

| Handoff | Builder / intent | Deliverables |
|---|---|---|
| `docs/guides/builder-handoff/agent-build.md` | `agent-builder` / `build` | an agent definition folder + `dependency-report/{agentId}.md` |
| `docs/guides/builder-handoff/agent-review.md` | `agent-builder` / `review` | `review-report/{agentId}.md` |
| `docs/guides/builder-handoff/pipeline-build.md` | `pipeline-builder` / `build` | one or more `pipeline.yaml` + `pipeline-report/{flowId}.md` |
| `docs/guides/builder-handoff/pipeline-review.md` | `pipeline-builder` / `review` | `review-report/{pipelineId}-pipeline.md` |

## Prerequisites

- A clone of this repository at the commit the target server runs (the
  deploy's tag; `main` when in doubt — the validators below are the server's,
  so a mismatched checkout judges by a different rule set).
- `pnpm install` at the repo root, then `pnpm --filter @ant/shared build`.
- The offline validator: `pnpm --filter @ant/cli definition <command>`, from
  the repo root. It runs the same functions the server runs on the way in —
  `gateDefinitionSave`, `loadCustomJob`, `validatePipelineDefServer`, the
  catalog advisories, the cron parser — so a folder that passes here is a
  folder the import accepts. Exit codes: `0` clean, `1` findings, `2` usage.

| Command | What it answers |
|---|---|
| `pnpm --filter @ant/cli definition validate-agent <agentDir>` | what `GET /definitions/agents/{agentId}/jobs/{jobId}/validate` would, for every job; plus what `PUT /definitions/agents/{agentId}/file` would have refused per file |
| `pnpm --filter @ant/cli definition validate-pipeline <pipeline.yaml> --agents <dir>` | the save funnel's `errors[]` and `catalogWarnings` |
| `pnpm --filter @ant/cli definition preview-fires "<cron>" --tz <zone>` | `POST /definitions/pipelines/preview-fires` |
| `pnpm --filter @ant/cli definition check-review <report.md> <materialDir>` | whether a review report's Trace table names every material file, and nothing else |

## Working tree

Every handoff uses one layout. `in/` is what you downloaded from Ant; `out/`
is what you hand back.

```
{work}/
  in/
    agents/{agentId}/…                  Agent Settings → ⋯ → Download, unzipped
    pipelines/{pipelineId}/pipeline.yaml Pipelines rail → Download, unzipped
    artifacts/                          the project's Artifacts panel: dependency-report/, pipeline-report/, review-report/
    material/…                          the source material (an inventory domain folder, a procedure, a schedule)
  out/
    agents/{agentId}/…                  the definition folder — its name IS the agent id
    pipelines/{pipelineId}/pipeline.yaml the folder name IS the pipeline id on import
    artifacts/{dependency-report,pipeline-report,review-report}/…
```

Builtin definitions never need downloading: they are in the clone under
`packages/ant-cli/src/core/data/agents/`, and their ids are taken.

## Bringing deliverables in

These are a person's steps in the Ant UI. The builders' own API token is
refused on the upload routes by design, so an agent running inside Ant cannot
do this part; you can.

1. Agent folder → Agent Settings → the upload icon on the agent rail → pick
   `out/agents/{agentId}`. A `409` offers to replace an agent you own. The
   response carries the loader verdict for every job; the screen shows it.
2. `pipeline.yaml` → Pipelines rail → upload → pick the file or its folder.
   A saved pipeline is a disabled draft until a person enables and activates
   it.
3. Reports → the project's Artifacts panel → upload into
   `dependency-report/`, `pipeline-report/` or `review-report/`. The next
   builder turn in that project reads them from there, exactly as it reads
   its own.

## What the guard pins

`packages/ant-cli/tests/policy/builder-handoff-binding.test.ts` fails the
build when a handoff drifts from the definition it fronts: a read-list that
misses a shipped file, a quoted path that does not exist, a hook or route
spelled differently from the builtin's `hooks.yaml` / `on-demand/api-surface.md`,
a CLI command that is not registered, or a section out of order. Prose is not
pinned — only the bindings.

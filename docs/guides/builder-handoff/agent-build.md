# Handoff — agent-builder / build, performed offline

## What this is

The shipped `agent-builder` definition is the contract for authoring a custom
agent; this file only maps its runtime channels to a working tree. Read the
contract from a clone at the server's commit (see
`docs/guides/builder-handoff/README.md`), do the work in `out/`, and hand back
the same two deliverables the builtin owes: the definition folder and its
dependency report.

## Read, in this order

Reading a bundle? These files follow verbatim under "Part 2 — Contract files",
in this order; the paths below are where a clone keeps them. Either way, read
every file in full before designing.

Read every file in full before designing. The order is the order the runtime
injects them.

1. `packages/ant-cli/src/core/data/agents/agent-builder/base/role.md` — who
   the agent is, its authority, the language rule, how to read a failed call.
2. `packages/ant-cli/src/core/data/agents/agent-builder/jobs/author/base/system.md`
   — the five-step procedure.
3. `packages/ant-cli/src/core/data/agents/agent-builder/jobs/author/job.yaml` —
   the tools and the API allow list the runtime builder has; the substitution
   table below is keyed on them.
4. `packages/ant-cli/src/core/data/agents/agent-builder/jobs/author/intents/build/infer.md`
   and `packages/ant-cli/src/core/data/agents/agent-builder/jobs/author/intents/build/prompt.md`
   — the criterion and the whole authoring contract: partition doctrine,
   altitude rules, the dependency-report skeleton, the chat report.
5. `packages/ant-cli/src/core/data/agents/agent-builder/jobs/author/intents/build/hooks.yaml`
   — the completion contract you must satisfy (see "Done when").
6. `packages/ant-cli/src/core/data/agents/agent-builder/on-demand/definition-format.md`
   — the file contract: layout, `agent.yaml` / `job.yaml` / `infer.md` /
   `hooks.yaml` grammars, the tool vocabulary.
7. `packages/ant-cli/src/core/data/agents/agent-builder/on-demand/api-surface.md`
   — the routes the prose refers to; every one has a row below.
8. `packages/ant-cli/src/core/data/agents/agent-builder/on-demand/audit.md` —
   the checklist the build turn sweeps before each save.
9. The review intent's files are not part of this job, but its instructions
   are the standard your output is later judged by:
   `packages/ant-cli/src/core/data/agents/agent-builder/jobs/author/intents/review/prompt.md`,
   with its criterion and hook
   `packages/ant-cli/src/core/data/agents/agent-builder/jobs/author/intents/review/infer.md`,
   `packages/ant-cli/src/core/data/agents/agent-builder/jobs/author/intents/review/hooks.yaml`.

A worked example that already passes the validator:
`examples/custom-agents/ops-team`.

## Working tree

```
in/agents/{agentId}/…                     existing definitions you were asked to edit (downloaded zips)
in/artifacts/dependency-report/…          the agent's earlier reports, when any
in/material/…                             what the agent is to be authored from
out/agents/{agentId}/…                    the definition — folder name = agent id
out/artifacts/dependency-report/{agentId}.md
```

## Channel substitution table

| Runtime instruction (where in the prose) | Offline equivalent | Same validator? |
|---|---|---|
| "Look first" — `GET /definitions/agents` (`base/system.md` step 1) | `ls in/agents/` plus `ls packages/ant-cli/src/core/data/agents/` — builtin ids are taken and answer `409` on import | n/a |
| `GET /definitions/agents/{agentId}/files`, `GET /definitions/agents/{agentId}/file?path=…`, `read_file _agents/{agentId}/…`, `_agent-definition/…` | read `in/agents/{agentId}/{path}` (the Agent Settings download, unzipped) or the clone path for a builtin | n/a |
| `POST /definitions/agents` `{ id, name }` | `mkdir out/agents/{agentId}` and write `agent.yaml` (`id` = folder name, `name`, `version: 1`) — write the real `base/role.md`, not a scaffold | yes, via `validate-agent` |
| `POST /definitions/agents/{agentId}/jobs` `{ id, name }` | `mkdir out/agents/{agentId}/jobs/{jobId}` and write `job.yaml` + `base/system.md` | yes |
| `PUT /definitions/agents/{agentId}/file` `{ path, content }` — the write you will use most | write `out/agents/{agentId}/{path}`, whole file; the whitelist and the 1 MiB per-file cap are enforced by the validator | yes — `gateDefinitionSave` per file |
| `PATCH /definitions/agents/{agentId}`, `POST /definitions/agents/{agentId}/rename`, `DELETE /definitions/agents/{agentId}` | edit `agent.yaml` `name`; rename the folder (and the `id` inside); delete the folder | yes |
| `PATCH /definitions/agents/{agentId}/jobs/{jobId}`, `POST /definitions/agents/{agentId}/jobs/{jobId}/rename`, `DELETE /definitions/agents/{agentId}/jobs/{jobId}` | edit `job.yaml` `name`; rename the job folder (and its `id`); delete it | yes |
| `POST /definitions/agents/{agentId}/files/create`, `POST /definitions/agents/{agentId}/files/mkdir`, `POST /definitions/agents/{agentId}/files/rename`, `DELETE /definitions/agents/{agentId}/file?path=…` | plain file operations under `out/agents/{agentId}` | yes |
| `GET /definitions/agents/{agentId}/jobs/{jobId}/validate` (`base/system.md` step 4) | `pnpm --filter @ant/cli definition validate-agent out/agents/{agentId}` — every job; `--job {jobId}` for one; exit `0` is "valid" | yes — same `loadCustomJob`, same advisories, same words |
| `4xx` bodies — "When a call fails" (`base/role.md`) | the validator's `error:` lines carry the server's own messages; `403`/`404` cannot happen offline; `409` is deferred to the import | yes |
| `GET /definitions/agents/{agentId}/jobs/{jobId}/prompt-preview` | none offline — after import, the agent settings screen shows the composed prompt | n/a |
| `GET /definitions/agents/{agentId}/permissions` | none offline — org access is a person's setting | n/a |
| `create_file dependency-report/{agentId}.md` (`build/prompt.md`, "Write the agent's dependency report") | write `out/artifacts/dependency-report/{agentId}.md`; the newest-existing rule reads `in/artifacts/dependency-report/{agentId}*.md` (legacy `dependencies/{agentId}.md`) and, when one exists from an earlier session, you write `{agentId}-{mnemonic}.md` instead | n/a (a report, not a definition) |
| `<checklist>` before the first write | a plain checklist at the top of your reply | n/a |
| clarify — the two cases in `base/system.md` | stop and ask the person before the first write; do not guess a partition that reshapes their material | n/a |
| `read_ant_source`, `list_ant_files`, `search_ant_code` | read the clone: `packages/ant-cli/src/**`, `packages/ant-shared/src/**`, `docs/**` | n/a |
| `fetch_url`, `search_web` | your own tools | n/a |

## Bring it in

Agent Settings → upload icon on the rail → pick `out/agents/{agentId}`. A
`409` means the id exists: replace only an agent you own, otherwise rename the
folder and the `id` inside `agent.yaml`. The response carries the loader
verdict for every job and the screen reports it — it should say nothing,
because `validate-agent` already passed. Then upload
`out/artifacts/dependency-report/{agentId}.md` into the project's Artifacts
panel under `dependency-report/`.

## Done when

The builtin's `hooks.yaml` for this intent reads `arm: on-write` with two stop
hooks, `api__ant__request PUT /definitions/agents/*/file` and
`dependency-report/*.md`. Offline that is:

- at least one definition file exists under `out/agents/{agentId}/` and
  `pnpm --filter @ant/cli definition validate-agent out/agents/{agentId}` exits `0`;
- `out/artifacts/dependency-report/{agentId}.md` (or its `-{mnemonic}`
  revision) exists and follows the skeleton in `build/prompt.md`;
- your reply is the chat report the contract describes, naming the report's
  path.

A turn that changed nothing writes nothing — say so instead.

Without a clone there is no validator to run: deliver, let the person import,
and treat the `validation` lines the import answers as the findings to fix.

## Out of scope offline

`prompt-preview` and `permissions` have no offline twin; the import's `409`
replaces the pre-flight id check. `promote`, `editors`, `import` and
`files/upload` are a person's routes in every mode — the runtime builder is
refused on them too.

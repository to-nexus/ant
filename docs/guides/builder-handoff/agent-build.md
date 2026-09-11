# Handoff — agent-builder / build, performed offline

## What this is

The shipped `agent-builder` definition is the contract for authoring a custom
agent; this file only maps its runtime channels to a working tree. The
contract itself is Part 2 of this bundle — read it there, in full — and hand
back the same two deliverables the builtin owes: the definition folder and its
dependency report.

## Read, in this order

Each path below is a `## FILE:` heading in Part 2, in this order — walk Part 2
from top to bottom and you have read the list. (A clone at the server's commit
keeps the same bytes at the same paths.) Read every file in full before
designing; the order is the order the runtime injects them.

1. `packages/ant-cli/src/core/data/agents/agent-builder/base/role.md` — who
   the agent is, its authority, the language rule, how to read a failed call.
2. `packages/ant-cli/src/core/data/agents/agent-builder/jobs/author/base/system.md`
   — the five-step procedure.
3. `packages/ant-cli/src/core/data/agents/agent-builder/jobs/author/job.yaml` —
   the tools and the API allow list the runtime builder has; the substitution
   table below is keyed on them.
4. `packages/ant-cli/src/core/data/agents/agent-builder/jobs/author/intents/build/infer.md`
   — the criterion that selects this intent.
5. `packages/ant-cli/src/core/data/agents/agent-builder/jobs/author/intents/build/prompt.md`
   — the whole authoring contract: partition doctrine, altitude rules, the
   dependency-report skeleton, the chat report.
6. `packages/ant-cli/src/core/data/agents/agent-builder/jobs/author/intents/build/hooks.yaml`
   — the completion contract you must satisfy (see "Done when").
7. `packages/ant-cli/src/core/data/agents/agent-builder/on-demand/api-surface.md`
   — the routes the prose refers to; every one has a row below.
8. `packages/ant-cli/src/core/data/agents/agent-builder/on-demand/audit.md` —
   the checklist the build turn sweeps before each save.
9. `packages/ant-cli/src/core/data/agents/agent-builder/on-demand/definition-format.md`
   — the file contract: layout, `agent.yaml` / `job.yaml` / `infer.md` /
   `hooks.yaml` grammars, the tool vocabulary.
10. The review intent's files are not part of this job, but its instructions
    are the standard your output is later judged by:
    `packages/ant-cli/src/core/data/agents/agent-builder/jobs/author/intents/review/infer.md`,
    `packages/ant-cli/src/core/data/agents/agent-builder/jobs/author/intents/review/prompt.md`,
    `packages/ant-cli/src/core/data/agents/agent-builder/jobs/author/intents/review/hooks.yaml`.

## Working tree

No layout is prescribed. Four names bind; group everything else however suits
you, and say in your closing report where you put it.

- Work where the person says. When nobody says, make a fresh folder OUTSIDE
  any Ant clone — anything written under a repository root, `packages/` or
  `docs/` lands in git's working tree, where a checkout can sweep it away.
- **The definition folder's name IS the agent id.** The import reads the id
  off that single top-level folder, so it is `payments-ops/agent.yaml`, never
  `my-agent/agent.yaml` or a nested `definition/payments-ops/`.
- **Inside it, every path is the API's `path` verbatim**: `agent.yaml`,
  `base/role.md`, `jobs/{jobId}/job.yaml`,
  `jobs/{jobId}/intents/{intentId}/prompt.md`, `on-demand/*.md`.
- **The report is `dependency-report/{agentId}.md`** — keep it under a folder
  of that name and the upload target names itself.

Keep what you were given apart from what you produce, and never write back
into the inputs. One shape that works, when nothing else is asked for:
`material/`, `given/`, `{agentId}/`, `dependency-report/`.

## Channel substitution table

"Same validator?" means the same server functions judge your work either way:
with a clone you run them yourself, without one the import runs them as it
accepts the folder. A cell that names a clone-only command says so.

| Runtime instruction (where in the prose) | Offline equivalent | Same validator? |
|---|---|---|
| "Look first" — `GET /definitions/agents` (`base/system.md` step 1) | list the definitions the person handed you; the builtin ids (`agent-builder`, `pipeline-builder`) are taken and answer `409` on import, and Part 2 holds this builder's own files | n/a |
| `GET /definitions/agents/{agentId}/files`, `GET /definitions/agents/{agentId}/file?path=…`, `read_file _agents/{agentId}/…`, `_agent-definition/…` | read `{path}` inside the definition you were given (the Agent Settings download, unzipped); for a builtin, Part 2 (or the same path in a clone) | n/a |
| `POST /definitions/agents` `{ id, name }` | create the definition folder, named `{agentId}`, and write `agent.yaml` in it (`id` = folder name, `name`, `version: 1`) — write the real `base/role.md`, not a scaffold | yes |
| `POST /definitions/agents/{agentId}/jobs` `{ id, name }` | `mkdir {agentId}/jobs/{jobId}` and write `job.yaml` + `base/system.md` | yes |
| `PUT /definitions/agents/{agentId}/file` `{ path, content }` — the write you will use most | write `{agentId}/{path}`, whole file; the whitelist and the 1 MiB per-file cap are enforced by the validator | yes — `gateDefinitionSave` per file |
| `PATCH /definitions/agents/{agentId}`, `POST /definitions/agents/{agentId}/rename`, `DELETE /definitions/agents/{agentId}` | edit `agent.yaml` `name`; rename the folder (and the `id` inside); delete the folder | yes |
| `PATCH /definitions/agents/{agentId}/jobs/{jobId}`, `POST /definitions/agents/{agentId}/jobs/{jobId}/rename`, `DELETE /definitions/agents/{agentId}/jobs/{jobId}` | edit `job.yaml` `name`; rename the job folder (and its `id`); delete it | yes |
| `POST /definitions/agents/{agentId}/files/create`, `POST /definitions/agents/{agentId}/files/mkdir`, `POST /definitions/agents/{agentId}/files/rename`, `DELETE /definitions/agents/{agentId}/file?path=…` | plain file operations under `{agentId}/` | yes |
| `GET /definitions/agents/{agentId}/jobs/{jobId}/validate` (`base/system.md` step 4) | without a clone, the import answers it: Agent Settings reports the loader verdict for every job, and those lines are your findings. With a clone, `pnpm --filter @ant/cli definition validate-agent <the definition folder>` — every job, `--job {jobId}` for one, exit `0` is "valid" | with a clone, yes — same `loadCustomJob`, same advisories, same words; otherwise the import |
| `4xx` bodies — "When a call fails" (`base/role.md`) | the import's response carries the server's own messages, as do the validator's `error:` lines with a clone; `403`/`404` cannot happen offline; `409` is deferred to the import | yes |
| `GET /definitions/agents/{agentId}/jobs/{jobId}/prompt-preview` | none offline — after import, the agent settings screen shows the composed prompt | n/a |
| `GET /definitions/agents/{agentId}/permissions` | none offline — org access is a person's setting | n/a |
| `create_file dependency-report/{agentId}.md` (`build/prompt.md`, "Write the agent's dependency report") | write `dependency-report/{agentId}.md`; the newest-existing rule reads the earlier reports you were given (`{agentId}*.md`, legacy `dependencies/{agentId}.md`), and when one exists from an earlier session you write `{agentId}-{mnemonic}.md` instead | n/a (a report, not a definition) |
| `<checklist>` before the first write | a plain checklist at the top of your reply | n/a |
| clarify — the two cases in `base/system.md` | stop and ask the person before the first write; do not guess a partition that reshapes their material | n/a |
| `read_ant_source`, `list_ant_files`, `search_ant_code` | nothing to substitute, and nothing you need: Part 2 is the whole contract for this job, so Ant's own source never decides anything here. If you believe you need it, stop and say so rather than improvising (with a clone: `packages/ant-cli/src/**`, `packages/ant-shared/src/**`, `docs/**`) | n/a |
| `fetch_url`, `search_web` | your own tools | n/a |

## Bring it in

Agent Settings → upload icon on the rail → pick the definition folder. A
`409` means the id exists: replace only an agent you own, otherwise rename the
folder and the `id` inside `agent.yaml`. The response carries the loader
verdict for every job and the screen reports it. Then upload
`dependency-report/{agentId}.md` into the project's Artifacts panel under
`dependency-report/`.

## Done when

The builtin's `hooks.yaml` for this intent reads `arm: on-write` with two stop
hooks, `api__ant__request PUT /definitions/agents/*/file` and
`dependency-report/*.md`. Offline that is:

- the definition folder holds at least one definition file, and every file you
  wrote is one the definition format allows. With a clone,
  `pnpm --filter @ant/cli definition validate-agent <that folder>` exits `0`;
  without a clone the import is that check — deliver, and treat the loader
  verdict its response carries as the findings to fix;
- `dependency-report/{agentId}.md` (or its `-{mnemonic}` revision) exists and
  follows the skeleton in `build/prompt.md`;
- your reply is the chat report the contract describes, naming the report's
  path.

A turn that changed nothing writes nothing — say so instead.

## Out of scope offline

`prompt-preview` and `permissions` have no offline twin; the import's `409`
replaces the pre-flight id check. Browsing Ant's own source is unavailable and
unnecessary — Part 2 is the contract. `promote`, `editors`, `import` and
`files/upload` are a person's routes in every mode — the runtime builder is
refused on them too.

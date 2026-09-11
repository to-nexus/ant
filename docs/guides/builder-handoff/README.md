# Builder handoffs — the same job, done by an external agent

한국어판: [README.ko.md](README.ko.md)

Ant ships two builtin builders, `agent-builder` and `pipeline-builder`. Each
carries one job, `author`, with two intents: `build` (author or change a
definition, leave a report) and `review` (judge a finished definition against
the material it came from, leave a report). Their prose under
`packages/ant-cli/src/core/data/agents/` **is the contract** — the file
format, the design doctrine, the report skeletons, the completion hooks — and
it is executed against the real validators by
`packages/ant-cli/tests/customAgents/builtin-agents.test.ts`.

You can always do this work inside Ant: pick `Agent Builder` or
`Pipeline Builder` in the composer, attach the material with `@ctx`, and pin
the `build` or `review` intent. Nothing here replaces that path — it hands the
same job to an agent running somewhere else, which is often a better author
because you can point a frontier model at it.

The documents in this directory let any agent do exactly the builtin's job and
hand back exactly the builtin's deliverables, without a second copy of the
contract. **Each handoff carries only the channel deltas**: which contract
files to read, in what order, and what to do offline where the prose says
"call the API". Nothing in here restates a rule; if a handoff and the builtin
prose ever disagree, the prose wins and the handoff has a bug.

| Handoff | Builder / intent | Deliverables |
|---|---|---|
| `docs/guides/builder-handoff/agent-build.md` | `agent-builder` / `build` | an agent definition folder + `dependency-report/{agentId}.md` |
| `docs/guides/builder-handoff/agent-review.md` | `agent-builder` / `review` | `review-report/{agentId}.md` |
| `docs/guides/builder-handoff/pipeline-build.md` | `pipeline-builder` / `build` | one or more `pipeline.yaml` + `pipeline-report/{flowId}.md` |
| `docs/guides/builder-handoff/pipeline-review.md` | `pipeline-builder` / `review` | `review-report/{pipelineId}-pipeline.md` |

## 1. Get the handoff

Each handoff downloads as ONE self-contained markdown bundle: Part 1 is the
handoff, Part 2 inlines every contract file it names, Part 3 a worked example.
Give that file to any agent that reads markdown and it has everything — no
clone of this repository required.

In Ant: **Agent Settings → the builder's ⋯ menu → "Download handoff · build"**
(or `· review`). Pick `Agent Builder` for agents, `Pipeline Builder` for
pipelines. The server composes the bundle from its own definition files, so
what the agent reads is the version it will import into.

![The builder's ⋯ menu in Agent Settings, showing Download folder, Download handoff · build, and Download handoff · review](download-handoff-menu.png)

From a clone: `pnpm --filter @ant/cli definition handoff agent-builder author build --out handoff.md`.

## 2. Get what the work needs

Everything else the agent needs comes out of Ant the same way, through the UI.
Download what applies and put it wherever you want the agent to work.

| What | Where to get it | When you need it |
|---|---|---|
| The material | Wherever your team keeps it — a work-inventory domain folder, a procedure, a schedule | Always. The agent reads ALL of it |
| An existing agent definition | Agent Settings → that agent's ⋯ → **Download folder** (a zip; unzip it) | Editing or reviewing an agent |
| An existing pipeline | Pipelines rail → the pipeline's download (a zip; unzip it) | Editing or reviewing a pipeline |
| The agents a pipeline runs | Agent Settings → each agent's ⋯ → **Download folder** | Authoring or reviewing a pipeline |
| Earlier reports | The project's Artifacts panel → `dependency-report/`, `pipeline-report/`, `review-report/` | Editing, and every review |

Builtin definitions are never downloaded: a bundle inlines the builder's own
in Part 2, and a clone has them under
`packages/ant-cli/src/core/data/agents/`. Their ids are taken either way.

## 3. Tell the agent

Open the agent in the folder you prepared. One instruction is enough; the
handoff carries the rest.

```
Read handoff.md and do exactly what it says. Work in this folder.
The material is everything under material/ — all of it.
When you are done, list what you produced, where, and what remains a person's step.
```

Name whatever you actually called things. Beyond "work here, the material is
there", no layout is prescribed: each handoff states the two or three names
that genuinely bind — a definition folder is named with the agent id, a
pipeline folder with the pipeline id, a report with the id it is about — and
leaves the rest to the agent, which reports back where it put things.

One rule is not negotiable, and the handoffs repeat it: **work outside any Ant
clone.** Anything written under a repository root, `packages/` or `docs/` lands
in git's working tree, where a checkout can sweep it away.

## 4. Bring the deliverables in

These are a person's steps in the Ant UI. The builders' own API token is
refused on the upload routes by design, so an agent running inside Ant cannot
do this part; you can.

1. Agent folder → Agent Settings → the upload icon on the agent rail → pick
   the definition folder. A `409` offers to replace an agent you own. The
   response carries the loader verdict for every job; the screen shows it.
2. `pipeline.yaml` → Pipelines rail → upload → pick the file or its folder.
   A saved pipeline is a disabled draft until a person enables and activates
   it.
3. Reports → the project's Artifacts panel → upload into
   `dependency-report/`, `pipeline-report/` or `review-report/`. The next
   builder turn in that project reads them from there, exactly as it reads
   its own.

**Without a clone, the import is the validator.** The agent-folder import and
the pipeline upload answer the loader verdict in their response and the screen
shows it; paste those lines back to the agent, let it fix them, and upload
again.

## 5. Raise the quality: review, fix, review

The review handoffs exist to be run repeatedly. Run one in a **separate
session** from the build — a reviewer holding the author's reasoning in its
context audits itself, and that failure is measured, not theoretical.

1. Review the definition against the material it was authored from. The report
   carries one Trace row per material file: carried, merged, split, changed,
   dropped, or retired in the material — plus the reverse direction, and a
   verdict on each claim the authoring report made about itself.
2. Hand its Findings back to a build session and have them applied.
3. Review again. A `dropped` or `unsourced` row still standing with no
   explanation means the work is not finished.

## With a clone: the offline validator

A clone at the commit the server runs adds `pnpm --filter @ant/cli definition
<command>`, run from the repo root after `pnpm install` and
`pnpm --filter @ant/shared build`. It runs the same functions the server runs
on the way in — `gateDefinitionSave`, `loadCustomJob`,
`validatePipelineDefServer`, the catalog advisories, the cron parser — so a
folder that passes here is a folder the import accepts. Exit codes: `0` clean,
`1` findings, `2` usage. A mismatched checkout judges by a different rule set;
the bundle route never has that problem.

| Command | What it answers |
|---|---|
| `pnpm --filter @ant/cli definition validate-agent <agentDir>` | what `GET /definitions/agents/{agentId}/jobs/{jobId}/validate` would, for every job; plus what `PUT /definitions/agents/{agentId}/file` would have refused per file |
| `pnpm --filter @ant/cli definition validate-pipeline <pipeline.yaml> --agents <dir>` | the save funnel's `errors[]` and `catalogWarnings` |
| `pnpm --filter @ant/cli definition preview-fires "<cron>" --tz <zone>` | `POST /definitions/pipelines/preview-fires` |
| `pnpm --filter @ant/cli definition check-review <report.md> <materialDir>` | whether a review report's Trace table names every material file, and nothing else |
| `pnpm --filter @ant/cli definition handoff <agentId> <jobId> <intentId> --out <file>` | the same bundle the "Download handoff" menu serves, composed from this clone |

With a clone you can also hand the agent the handoff file at its path instead
of a bundle, and add the validator to the finish line:

```
Read /path/to/ant/docs/guides/builder-handoff/agent-build.md and do exactly what it says.
Work in this folder (not inside the clone). The material is everything under material/.
Before reporting, run the handoff's validate command from /path/to/ant and show me it exits 0.
```

## What the guard pins

`packages/ant-cli/tests/policy/builder-handoff-binding.test.ts` fails the
build when a handoff drifts from the definition it fronts: a read-list that
misses a shipped file, a quoted path that does not exist, a hook or route
spelled differently from the builtin's `hooks.yaml` / `on-demand/api-surface.md`,
a CLI command that is not registered, or a section out of order. Prose is not
pinned — only the bindings.

# Spaces — Codespace & Workspace

Every Ant project is one of two kinds, chosen when you create it:

| | **Codespace** | **Workspace** |
|---|---|---|
| What it is for | building a product | running your organization's own work agents |
| Jobs it exposes | `plan` `design` `code` `visual` `learn` `ask` | custom jobs only, defined in files |
| Unit of work | a **feature** (branch + worktree) | an **(agent, job)** pair |
| Git, preview, browser IDE | yes | no — a workspace has no codebase |
| On disk | `repo.git` + `features/{feature}/…` | `universal/{artifacts,sessions}/` |

The kind is stored as `projectType` in the project's `config.json`
(`'canonical'` = codespace, `'universal'` = workspace; absent means codespace,
so every project that predates the split is one). It is a **creation-time
decision and cannot be changed afterwards**, because the two kinds put
different things on disk and answer to different job pipelines.

`projectType` is **pure policy: it decides which jobs a project exposes, never
the layout.** The `universal/` plane is namespaced the same way in both kinds —
a codespace simply never populates it. That is what keeps the flag from
becoming a fork.

**Which jobs run where** is a strict partition, enforced in both directions at
the HTTP boundary:

| Job type | Codespace | Workspace |
|---|---|---|
| `plan` `design` `code` `visual` `learn` `ask` `inline-ask` | ✅ | ✗ `project-universal-requires-custom-job` |
| `universal` (the custom-agent runtime) | ✗ `project-not-universal` | ✅ — the only type it runs |

Note the partition is `universal` vs *everything else* — there is no job type
that runs in both kinds.

> **"Workspace" means four things in this repository.** The word is overloaded,
> and only the last sense is what this page's right-hand column is about:
>
> 1. the **account root** on disk — `workspaces/{organizationId}/{userId}/`,
>    the tenant directory that holds all of your projects;
> 2. **`WorkspaceConfig`** — the type of a project's `config.json`, regardless
>    of kind (it is the thing that *carries* `projectType`);
> 3. the **per-agent-run scope** — the Resolved Action Context a single job
>    sees ([below](#workspace-per-agent-run));
> 4. a **workspace project** — `projectType: 'universal'`, the custom-agent
>    kind.
>
> When a doc or a UI label says "Workspace" with a capital W next to
> "Codespace", it means sense 4.

For the isolation guarantees behind both layouts, see
[internals/20-workspace-isolation.md](../internals/20-workspace-isolation.md).

---

## Codespace layout

A codespace organizes work as **Project → Feature → Workspace**. Each level has
clear ownership and the directory layout reflects that.

### Hierarchy

Both trees below abbreviate the account root — the real prefix is
`workspaces/{organizationId}/{userId}/`.

```
workspaces/
└── <project>/
    └── <feature>/
        ├── plan/                   PRD authored by the planner
        ├── architecture/           System design + spec authored by architect.design
        │   ├── system/             fe-system-main.md, be-system-main.md, ...
        │   └── spec/               api-contract-main.md, spec-<flow>.md, ...
        ├── visual/                 Design-source artifacts
        │   ├── ui/                 service-domain UI sources (ant / figma / handoff)
        │   └── game-art/           game-domain art sources (sub-sourced)
        ├── assets/                 Static binary assets (per-domain pool)
        │   ├── service/            HUD/icon/logo for service domain
        │   └── game/               sprites, audio, textures for game domain
        ├── codebase/               The actual generated code (git-tracked)
        ├── meta/                   Job metadata (directives, evals)
        │   ├── directives/         User directives history
        │   └── evals/              Rubric-based evaluation reports
        └── sessions/               Agent runtime state (transient)
            └── architect/          Per-job session checkpoints
            └── planner/
```

The first-class axes are **domain semantic**: `plan/` (intent),
`architecture/` (contracts), `visual/` (design source), `assets/` (binaries),
`meta/` (job metadata), `sessions/` (runtime), `codebase/` (code).
Old I/O-shaped paths (`outputs/`, `inputs/`) are no longer used. Manual
sweeps are documented in [AGENTS.md § Workspace Layout Enforcement](../../AGENTS.md).

### What each layer owns

#### Project

A project is a deployable unit. It has:

- A name, an org, and a domain (`service` or `game` — the `game`
  domain is **in development**; pick `service` for production use).
- A `repoType` (`local` or `cloud`) that decides whether features share
  one git working tree or each get their own worktree.
- A base path on disk, under the account root (sense 1 above).

Projects are managed via the REST API; lifecycle is documented in
[AGENTS.md § Project / Feature Lifecycle](../../AGENTS.md#project--feature-lifecycle).

#### Feature

A feature is a unit of work — conceptually a branch plus its own artifact
directory.
Features inside one project share `codebase/` history (via git
worktrees in cloud mode, via the same checkout in local `repoType:local`
mode).

A feature owns:

- Its own `plan/`, `architecture/`, `visual/`, `assets/`, `sessions/`.
- Its own preview server (port allocated lazily).
- Its own kanban (the per-feature task queue snapshot in Redis).

#### Workspace (per agent run)

When a job runs, the agent reads its **Resolved Action Context (RAC)** —
the explicit set of `refs` and `context` slots — and writes outputs back
to the feature directory.

The RAC is what makes spec-driven workflow work: the agent never glob-walks
the workspace. It only sees what was put in the RAC by the upstream
intent. This is the SSOT enforced in
[AGENTS.md § state.artifacts is RAC-bound](../../AGENTS.md#stateartifacts-is-rac-bound).

### Sessions and resumption

`sessions/<agent>/<jobType>.json` is the canonical session checkpoint. It
contains:

- The state channel snapshot at the last completed phase.
- The kanban (queue + running + completed tasks).
- Artifact references (paths only — no content; pool is rehydrated from
  RAC at resume).
- Verification Session model (for tasks under `_shared/verify/`).

Resuming a job rehydrates from this file. Multiple sessions exist when a
feature runs different jobs (`plan`, `design`, `code` all live as
independent files).

Old debug artifacts (debug prompts, plans, logs, tokens, figma JSON)
under `sessions/<agent>/debug/` are pruned by the
[`debugRetention`](../internals/29-debug-logging.md) sweeper:
14 days / 50 entries cutoff with active-job protection.

### Codebase as first-class

The `codebase/` directory is **git-tracked**. A feature imported from an
existing project has a real git repo there; a greenfield feature grows one as
files are written.

`codebase/ANTRULES.md` is a per-codebase deviation ledger — it records
project-specific conventions that aren't auto-derivable from
`package.json` / `tsconfig.json`. The 3-condition filter (codebase-local,
not auto-derivable, cross-task invariant) is documented in
[internals/35-codebase-meta-policy.md](../internals/35-codebase-meta-policy.md).

### Asset pools — per domain

`assets/` is split by domain:

- `assets/service/` is referenced by `visual/ui/ant/ui-assets.json`.
- `assets/game/` is referenced by
  `visual/game-art/ant/game-art-assets.json` (only for `kind: 'external'`
  entries; `kind: 'inline'` entries carry their payload in the JSON).
  *(In development — see the game-domain notice in [design-input-channels](design-input-channels.md).)*

Asset routing is decided by `state.workspaceConfig.domain`. A project either
uses the service pool or the game pool — never both at once.

---

## Workspace layout

> ⚠️ **Experimental.** The workspace kind, the custom-agent runtime behind it,
> and the pipeline scheduler on top of it all ship and are covered by tests, but
> several parts are deliberately open — see [custom-agents.md](custom-agents.md)
> and [pipelines.md](pipelines.md) for the current limits.

A workspace has **no features**, so it has none of the feature axes above: no
`repo.git`, no `codebase/`, no per-feature preview. Feature creation is refused
outright, because a feature without git is a contradiction, not a degraded mode.

Everything lives under one **universal container**:

```
workspaces/
└── <project>/
    ├── config.json                  projectType: 'universal'
    └── universal/
        ├── artifacts/               the shared working tree (read-write for agents)
        │   ├── plan/                always materialized; plan turns write here
        │   │   └── {agentId}/{jobId}/
        │   └── …                    free-form; whatever your jobs produce
        └── sessions/
            ├── {agentId}/{jobId}.json   per-(agent, job) session checkpoint
            ├── {agentId}/debug/          token + execution logs
            ├── chat.jsonl                ONE chat per workspace
            └── feature.jsonl             prompt context record
```

Two ownership rules follow from that shape:

- **Artifacts are owned by the project, not by an agent.** One shared
  `universal/artifacts/` tree serves every agent and job — upload a folder once
  and every custom job in the project can read it. `plan/` is a reserved
  canonical directory (always present, contents clearable but the directory
  itself is never deleted or renamed), mirroring how a codespace feature owns
  `plan/`.
- **Definitions are owned by the account, not by the project.** The agents and
  jobs themselves live outside every project, so one definition serves all of
  your workspaces — see
  [custom-agents.md § where definitions live](custom-agents.md#where-definitions-live-scopes).

The chat is **one conversation per workspace**, exactly like a codespace
feature's one chat. Switching the active agent and job with the composer's chips
switches which session the turn lands in, the same way switching job types
inside a feature chat does — the conversation stream itself is shared.

### The pseudo-feature slot

Ant's HTTP routes, SSE streams, and session paths are all `:feature`-shaped. A
workspace has no features, so it rides a **reserved constant** in that slot:
`UNIVERSAL_FEATURE = 'universal'` (exported from `@ant/shared`). Requests carry
it verbatim, and it resolves to `{project}/universal` — which is why the
container directory and the feature slot share a name. Any other value in that
slot on a workspace project is rejected.

The practical consequence: a workspace is invisible to the feature, git, and
preview lifecycles by construction, not by a chain of `if` statements.

### Progress: a checklist, not a kanban

A codespace job decomposes into **tasks** with a verification task gating
completion. A workspace job has no task plane at all. Instead the agent
maintains a **checklist** — it writes the list itself as it works, and the board
renders it. Checklist items are not tasks: they never enter a task queue, never
render as kanban cards, and never count toward per-task billing.

Details, including when a checklist appears at all, are in
[custom-agents.md](custom-agents.md).

### Unattended runs

A workspace job is not limited to what a human starts. A **pipeline** binds a
cron trigger and a chain of steps to one workspace project, so the same
(agent, job) pair runs on a calendar and can stop for a human at an approval
gate. While a project holds an activation, interactive job starts on it are
refused — an unattended run owns its project. See
[pipelines.md](pipelines.md).

## Read next

- [**custom-agents**](custom-agents.md) — the agent/job definition model that
  runs inside a workspace, and what the runtime gives every custom job.
- [**pipelines**](pipelines.md) — running those jobs on a schedule.
- [**design-input-channels**](design-input-channels.md) — the three UI
  input modes and how they map into `visual/ui/` (codespace only).
- [internals/35-codebase-meta-policy.md](../internals/35-codebase-meta-policy.md)
  — `codebase/` and `ANTRULES.md` deep dive.
- [reference/env-vars.md](../reference/env-vars.md) — the path and
  credential-store environment variables both kinds use.

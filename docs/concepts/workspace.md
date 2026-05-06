# Workspace layout

Ant organizes work as **Project → Feature → Workspace**. Each level has
clear ownership and the directory layout reflects that.

For the deep dive on isolation guarantees, see
[internals/20-workspace-isolation.md](../internals/20-workspace-isolation.md).

## Hierarchy

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

## What each layer owns

### Project

A project is a deployable unit. It has:

- A name, an org, and a domain (`service` or `game`).
- A `repoType` (`local` or `cloud`) that decides whether features share
  one git working tree or each get their own worktree.
- A workspace base path on disk.

Projects are managed via the REST API; lifecycle is documented in
[AGENTS.md § Project / Feature Lifecycle](../../AGENTS.md#project--feature-lifecycle).

### Feature

A feature is a unit of work — conceptually a branch + workspace combo.
Features inside one project share `codebase/` history (via git
worktrees in cloud mode, via the same checkout in local `repoType:local`
mode).

A feature owns:

- Its own `plan/`, `architecture/`, `visual/`, `assets/`, `sessions/`.
- Its own preview server (port allocated lazily).
- Its own kanban (the per-feature task queue snapshot in Redis).

### Workspace (per agent run)

When a job runs, the agent reads its **Resolved Action Context (RAC)** —
the explicit set of `refs` and `context` slots — and writes outputs back
to the feature directory.

The RAC is what makes spec-driven workflow work: the agent never glob-walks
the workspace. It only sees what was put in the RAC by the upstream
intent. This is the SSOT enforced in
[AGENTS.md § state.artifacts is RAC-bound](../../AGENTS.md#stateartifacts-is-rac-bound).

## Sessions and resumption

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

## Codebase as first-class

The `codebase/` directory is **git-tracked**. Existing-project workspaces
have a real git repo there; greenfield workspaces grow one as files are
written.

`codebase/ANTRULES.md` is a per-codebase deviation ledger — it records
project-specific conventions that aren't auto-derivable from
`package.json` / `tsconfig.json`. The 3-condition filter (codebase-local,
not auto-derivable, cross-task invariant) is documented in
[AGENTS.md § Codebase Meta Document Policy](../../AGENTS.md#codebase-meta-document-policy).

## Asset pools — per domain

`assets/` is split by domain:

- `assets/service/` is referenced by `visual/ui/ant/ui-assets.json`.
- `assets/game/` is referenced by
  `visual/game-art/ant/game-art-assets.json` (only for `kind: 'external'`
  entries; `kind: 'inline'` entries carry their payload in the JSON).

Asset routing is decided by `state.workspaceConfig.domain`. A workspace
either uses the service pool or the game pool — never both at once.

## Read next

- [**design-input-channels**](design-input-channels.md) — the three UI
  input modes and how they map into `visual/ui/`.
- [internals/35-codebase-meta-policy.md](../internals/35-codebase-meta-policy.md)
  — `codebase/` and `ANTRULES.md` deep dive.
- [reference/env-vars.md](../reference/env-vars.md) — workspace-related
  environment variables.

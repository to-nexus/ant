<h1 align="center">Ant</h1>

<p align="center"><b>The spec-driven AI engineering platform.</b></p>

<p align="center">
  PRD → System Design → Code → Verification, in one self-hosted system.
</p>

<p align="center">
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-Apache%202.0-blue.svg"></a>
  <a href="https://github.com/to-nexus/ant/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/to-nexus/ant/actions/workflows/ci.yml/badge.svg"></a>
  <a href="README.ko.md"><img alt="Korean" src="https://img.shields.io/badge/lang-한국어-red"></a>
  <a href="docs/local-mode/install.md"><img alt="Quickstart" src="https://img.shields.io/badge/docs-quickstart-success"></a>
</p>

> ⚠️ **Status: pre-alpha.** Ant works end-to-end but the public API and
> file layout will move until the first tagged release. Track
> [milestones](../../milestones) for the roadmap.

---

## Why Ant?

Most AI coding tools are built around "vibe coding" — you tell the model
what you want, it writes some code, you tell it what's wrong, repeat. That
loop scales to demos and hobby projects, not to engineering.

Ant takes the opposite stance. We made a pipeline that respects how
engineering actually works:

1. Write the **PRD**. The `planner` agent helps you clarify it.
2. Generate the **system design** (architecture, contracts, system docs).
3. Write **code** that the system can verify against the spec.
4. Re-verify after every change.

Each step is a separate agent with its own prompt surface, its own tools,
and its own verification gate. The result is a system you can audit, not a
black box that occasionally writes code.

---

## Requirements

- **Node.js** >= 22.13 · **pnpm** 11.1.0 (`corepack enable && corepack prepare pnpm@11.1.0 --activate`)
- **Docker** + Compose — for Redis (required) and the optional sidecars
- **An LLM provider key** — see [Providers](#providers)

## Quickstart

```bash
git clone https://github.com/to-nexus/ant && cd ant
pnpm install

cp packages/ant-cli/.env.example.local packages/ant-cli/.env
# edit packages/ant-cli/.env
#   ANTHROPIC_API_KEY=sk-ant-...
#   ANT_ENCRYPTION_KEY=$(openssl rand -hex 32)

pnpm dev:infra:redis      # Redis — the only required infra
pnpm dev:all              # API + Realtime + Worker + Preview + UI + site
```

Open [http://localhost:4200](http://localhost:4200) and write your first
directive — for example, *"Build a TODO app with React and Tailwind"*.

`pnpm dev:infra` additionally starts ChromaDB and the visual-processor. Both
are **optional**: the vector DB is off unless you set
`ANT_VECTOR_DB_ENABLED=true` (RAG falls back to git-changes + keyword search),
and the visual-processor is only used by the `visual` job.

Full setup walkthrough: [docs/local-mode/install.md](docs/local-mode/install.md).
Going to the cloud (managed or self-host)?
See [docs/cloud-mode/install.md](docs/cloud-mode/install.md).

---

## Providers

Bring your own key. Configure one or more in `packages/ant-cli/.env`; models
are selectable per job and per node.

| Provider   | Env var             | Notes                                     |
|------------|---------------------|-------------------------------------------|
| Anthropic  | `ANTHROPIC_API_KEY` | Primary supported model                    |
| OpenAI     | `OPENAI_API_KEY`    |                                            |
| Google     | `GEMINI_API_KEY`    |                                            |
| DeepSeek   | `DEEPSEEK_API_KEY`  | Third-party, China-hosted — consent-gated  |
| GLM        | `GLM_API_KEY`       | Third-party, China-hosted — consent-gated  |
| Kimi       | `KIMI_API_KEY`      | Third-party, China-hosted — consent-gated  |

Consent-gated providers require an explicit in-app data-privacy acknowledgement
before they can be selected, because your prompts (which include your source
code) leave for a third-party jurisdiction.

---

## Bring your own design

Ant accepts **three kinds of design input** as first-class citizens. You
don't pick a tool — you drop what you have:

| Source               | What you drop                                   | When to use                                                              |
|----------------------|-------------------------------------------------|--------------------------------------------------------------------------|
| **Claude artifacts** | HTML/CSS/Markdown/PNG into `visual/ui/handoff/` | You've been iterating in Claude.ai. No license, no setup, no schema.     |
| **Figma**            | A Figma URL into `visual/ui/figma/figma.json`   | You have an existing Figma project. Live MCP exploration at prompt time. |
| **Nothing yet**      | Run a `design` job on your PRD                  | Greenfield. Ant authors the handoff bundle for you.                      |

The three sources are hard-exclusive per workspace and have different
interpretation contracts (Claude handoff is observation-only / FPOP, Figma
is live-fetched, ant-native JSON is schema-based).

**What a `design` job emits depends on the source you started from:**

| Intent          | Started from            | Output                                                              |
|-----------------|-------------------------|----------------------------------------------------------------------|
| `gen-ui-desc`   | a PRD (greenfield)      | `visual/ui/handoff/` — a `DESIGN.md`-anchored bundle with `styles.css`, `tokens/`, `components/`, `screens/`, `assets/` |
| `gen-ui-figma`  | `visual/ui/figma/figma.json` | `visual/ui/ant/` — the canonical trio `ui-tokens.json` + `ui-assets.json` + `ui-spec.json` |

The full design-input guide is in
[docs/guides/design-input/](docs/guides/design-input/).

---

## How it works

```
    ant-ui  4200          ant-site  4300         ← browser-facing
    React SPA (/app/*)    marketing (Next.js)
         │
─────────┼──────────────────────────────────────────────────────────
         │
┌────────┴─────────┐    ┌──────────────────┐    ┌──────────────────┐
│   ant-api  4100  │    │  ant-realtime    │    │  ant-preview     │
│  REST + IDE      │    │   4101 SSE       │    │   4102 dev srv   │
└────────┬─────────┘    └────────┬─────────┘    └────────┬─────────┘
         │                       │                       │
         └─────────── Redis (Pub/Sub + BullMQ) ──────────┘
                              │
                     ┌────────┴─────────┐
                     │   ant-job        │
                     │   spawns         │
                     │   job-runner     │
                     │   per request    │
                     └──────────────────┘

  optional sidecars:  ChromaDB (vector RAG)   visual-processor 4103
```

Four backend processes, one codebase, communicating over Redis only. Local mode
and cloud (Kubernetes) mode share the same data plane — local is just "all
processes on one machine".

Each job runs an agent **LangGraph** state machine: `resolve` → `triage` →
job-specific phases → `learn`.

| Agent       | Jobs it owns                                  |
|-------------|-----------------------------------------------|
| `architect` | `code`, `design`, `learn`, `ask`, `inline-ask` |
| `planner`   | `plan`                                        |
| `creator`   | `visual`                                      |

Read more: [docs/concepts/architecture.md](docs/concepts/architecture.md).

---

## Workspace model

A **project** has exactly one git repository: a hidden bare anchor at
`{project}/repo.git`. Every **feature** is an equal linked worktree at
`features/{feature}/codebase/`, and **the branch name is the feature name** —
no prefix, no sanitising. Feature names may contain `/`, so `feature/base` and
`release/1.0` work as you would expect.

A project with no features has no codebase. There is no privileged "main"
worktree — features are peers.

Alongside `codebase/`, each feature holds the artifacts the agents produce:
`plan/` (PRD), `architecture/` (system design + spec), `visual/` (UI and
game-art design), `assets/`, plus agent-internal `sessions/` and `meta/`.

---

## What it can build

| Domain                   | Status         | Examples                                     |
|--------------------------|----------------|----------------------------------------------|
| **Service** (web/backend)| Stable         | Full-stack SaaS, dashboards, REST APIs       |
| **Game**                 | In development | Phaser/Web games with sprites + HUD + audio  |

> The **game vertical** is scaffolded — domain registry, the `gameArtTier`
> visual surface, and the `design-game-art` intent set are all wired — but
> is **not production ready** yet. Expect rough edges and breaking changes
> until it's marked Stable. Service-domain workflows are the supported path
> today.

The two domains share the same agents but ship different prompt overlays,
different design templates, and different visual-tier catalogs. Adding
new verticals is a domain-registry change — no fork required.

---

## Features

- **Drop-in Claude designs.** Paste your Claude.ai artifact (HTML/CSS/MD)
  into `visual/ui/handoff/` and Ant treats it as observable-only design
  source. No conversion, no schema. Often the single biggest reason teams
  switch from prompt-only tools.
- **Figma MCP.** Live exploration via the Figma MCP server at prompt time —
  nothing is snapshotted to disk. Design tokens are emitted into the canonical
  `visual/ui/ant/` trio.
- **Multi-agent pipeline.** Planner writes the PRD, architect generates the
  system design and code, and a dedicated verification task proves it works
  before the job can finish.
- **5 execution tiers.** From one-shot Q&A to refs-grounded multi-task
  projects, dispatched automatically based on the request.
- **Live preview.** Per-feature dev server, hot reload, isolated workspace.
- **Browser IDE.** Launch VSCode with your codebase in one click — a Docker
  container locally, a Kubernetes Pod when `ANT_K8S_NAMESPACE` is set.
- **Self-hosted.** Bring your own LLM key from any of six providers. Runs on
  your infrastructure, on your terms.

### What is cloud-only

The repository contains the seams for the managed service — billing/credits,
organizations, deploy, and custom domains. In a self-hosted deployment these
are **inert**: capability gates leave no-op implementations in place, and you
pay your LLM provider directly rather than buying credits. Nothing in the
self-host path phones home.

---

## Documentation

- **[Local Mode](docs/local-mode/)** — install + develop on your own machine (Persona A)
- **[Cloud Mode](docs/cloud-mode/)** — install + develop for managed (Persona B) or self-host cloud (Persona C)
- **[Concepts](docs/concepts/)** — architecture, agents, jobs, execution tiers, spec-driven philosophy
- **[Guides](docs/guides/)** — design input, custom prompts, observability
- **[Reference](docs/reference/)** — CLI, env vars, API, shared types
- **[First feature](docs/getting-started/first-feature.md)** — PRD → Design → Code walkthrough
- **[Troubleshooting](docs/getting-started/troubleshooting.md)** — install-time and runtime hiccups
- **[한국어 문서](docs/ko/)** — Korean mirror

For contributors:
- **[CONTRIBUTING.md](CONTRIBUTING.md)** — dev setup, conventions, PR workflow
- **[AGENTS.md](AGENTS.md)** — binding architectural rules for human and AI contributors
- **[docs/internals/](docs/internals/)** — deep dives, SSOT policies, debug logging

---

## Stack

**Backend** — Node.js 22+, TypeScript (strict), Express, LangGraph,
Anthropic / OpenAI / Google SDKs, BullMQ, ioredis, Handlebars, Zod.

**Frontend** — React 18, Vite, Zustand, Tailwind CSS, Radix UI, ReactFlow.
The marketing site (`ant-site`) is a statically-exported Next.js app.

**Infrastructure** — pnpm workspaces, Redis, Docker, Kubernetes, EFS for
shared workspace volumes in cloud mode.

---

## Contributing

Ant ships with detailed internal architecture docs and an extensive test
suite. PRs welcome.

Start with [CONTRIBUTING.md](CONTRIBUTING.md). For binding architectural
rules, read [AGENTS.md](AGENTS.md) — it is the public source of truth that
both human and AI contributors must follow.

---

## License

Apache-2.0 — see [LICENSE](LICENSE).

---

<p align="center">
  <sub>Ant is an open-source project. Star to follow along, file issues to
  shape it, send PRs to ship it.</sub>
</p>

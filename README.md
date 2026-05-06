<h1 align="center">Ant</h1>

<p align="center"><b>The spec-driven AI engineering platform.</b></p>

<p align="center">
  PRD → System Design → Code → Verification, in one self-hosted system.
</p>

<p align="center">
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-Apache%202.0-blue.svg"></a>
  <a href="https://github.com/<org>/ant/actions"><img alt="Build" src="https://img.shields.io/badge/build-pending-lightgrey"></a>
  <a href="README.ko.md"><img alt="Korean" src="https://img.shields.io/badge/lang-한국어-red"></a>
  <a href="docs/getting-started/quickstart.md"><img alt="Quickstart" src="https://img.shields.io/badge/docs-quickstart-success"></a>
</p>

<!--
  Hero video: drop a 30-60s screencast (MP4, muted, 1280x720) here.
  Upload via GitHub user-attachments: open "New issue", drag the file into
  the description, copy the generated URL, paste it as a single line below
  (no markdown image syntax, no <video> tag — GitHub auto-renders raw URLs).

  Recipe + sanitize checklist:
    docs/internals/media-workflow.md (forthcoming)

  Until the GIF lands, this comment block is the placeholder.
-->

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

## Quickstart

```bash
git clone https://github.com/<org>/ant && cd ant
pnpm install
pnpm dev:infra            # Redis + ChromaDB via Docker
pnpm dev:local:all        # API + Realtime + Worker + Preview + UI
```

Open [http://localhost:5173](http://localhost:5173) and write your first
directive — for example, *"Build a Pong game in Phaser"*.

You'll need an LLM provider key. Anthropic Claude is the primary supported
model; OpenAI works for most jobs.

```bash
cp packages/ant-cli/.env.example.local packages/ant-cli/.env
# edit packages/ant-cli/.env
#   ANT_ANTHROPIC_API_KEY=sk-ant-...
#   ANT_ENCRYPTION_KEY=$(openssl rand -base64 32)
```

Full setup walkthrough: [docs/getting-started/quickstart.md](docs/getting-started/quickstart.md).

---

## Bring your own design

Ant accepts **three kinds of design input** as first-class citizens. You
don't pick a tool — you drop what you have:

| Source               | What you drop                                    | When to use                                                                  |
|----------------------|--------------------------------------------------|------------------------------------------------------------------------------|
| **Claude artifacts** | HTML/CSS/Markdown/PNG into `visual/ui/handoff/` | You've been iterating in Claude.ai. No license, no setup, no schema.        |
| **Figma**            | A Figma URL into `visual/ui/figma/figma.json`    | You have an existing Figma project. Live MCP exploration at prompt time.    |
| **Native tokens**    | Run a `design` job on a directive                | Greenfield. Ant generates `ui-tokens.json` + `ui-spec.json` for you.        |

The three sources are hard-exclusive per workspace and have different
interpretation contracts (Claude handoff is observation-only / FPOP, Figma
is live-fetched, ant-native is schema-based). The full design-input guide is
in [docs/guides/design-input/](docs/guides/design-input/).

---

## How it works

```
┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐
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
```

Four processes, one codebase, communicating over Redis only. Local mode and
cloud (Kubernetes) mode share the same data plane — local is just "all
processes on one machine".

Each job runs an agent **LangGraph** state machine: `resolve` → `triage` →
job-specific phases → `learn`. The `architect` agent has separate sub-graphs
for `code` / `design` / `learn` / `ask`; the `planner` agent owns the `plan`
graph.

Read more: [docs/concepts/architecture.md](docs/concepts/architecture.md).

---

## What it can build

| Domain                   | Examples                                     |
|--------------------------|----------------------------------------------|
| **Service** (web/backend)| Full-stack SaaS, dashboards, REST APIs       |
| **Game**                 | Phaser/Web games with sprites + HUD + audio  |

Both domains share the same agents but ship different prompt overlays,
different design templates, and different visual-tier catalogs. Add new
verticals by extending the domain registry — no fork required.

---

## Features

- **Drop-in Claude designs.** Paste your Claude.ai artifact (HTML/CSS/MD)
  into `visual/ui/handoff/` and Ant treats it as observable-only design
  source. No conversion, no schema. Often the single biggest reason teams
  switch from prompt-only tools.
- **Figma MCP, bidirectional.** Live exploration via the Figma MCP server.
  Design tokens auto-emitted; round-trip with Code Connect.
- **Multi-agent pipeline.** Planner writes the PRD, architect generates the
  system design and code, the verifier proves it works.
- **5 execution tiers.** From one-shot Q&A to refs-grounded multi-task
  projects, dispatched automatically based on the request.
- **Live preview.** Per-feature dev server, hot reload, isolated workspace.
- **Cloud IDE.** Launch a Pod with VSCode + your codebase in one click
  (Kubernetes mode). Local mode runs everything on your laptop.
- **Self-hosted.** Bring your own LLM key (Anthropic / OpenAI). Runs on your
  infrastructure, on your terms.

---

## Documentation

- **[Getting Started](docs/getting-started/)** — install, quickstart, first feature, troubleshooting
- **[Concepts](docs/concepts/)** — architecture, agents, jobs, execution tiers, spec-driven philosophy
- **[Guides](docs/guides/)** — self-hosting, cloud deployment, design input, custom prompts
- **[Reference](docs/reference/)** — CLI, env vars, API, shared types
- **[한국어 문서](docs/ko/)** — Korean mirror

For contributors:
- **[CONTRIBUTING.md](CONTRIBUTING.md)** — dev setup, conventions, PR workflow
- **[AGENTS.md](AGENTS.md)** — binding architectural rules for human and AI contributors
- **[docs/internals/](docs/internals/)** — deep dives, SSOT policies, debug logging

---

## Stack

**Backend** — Node.js 18+, TypeScript (strict), Express, LangGraph,
Anthropic / OpenAI SDKs, BullMQ, ioredis, Handlebars, Zod.

**Frontend** — React 18, Vite, Zustand, Tailwind CSS, Radix UI, ReactFlow.

**Infrastructure** — pnpm workspaces, Redis, Docker, Kubernetes, EFS for
shared workspace volumes in cloud mode.

---

## Contributing

We've shipped 50+ architecture docs and a thousand+ tests because we ship
serious software. PRs welcome.

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

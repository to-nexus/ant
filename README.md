<p align="center">
  <img src="docs/assets/wordmark.png" width="524"
       alt="ANT — The spec-driven AI engineering platform">
</p>

<p align="center">
  Build: <b>PRD → System & UI Design → Code</b> · Iterate: <b>Spec → Code</b> — every code job verifies itself. Self-hosted.<br>
  <sub>Frontend · Backend · Extensible language/framework tiers · Service connections & mock virtualization · Per-feature dev servers · Browser IDE · Deploy (managed cloud)</sub>
</p>

<p align="center">
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-Apache%202.0-blue.svg"></a>
  <a href="https://github.com/to-nexus/ant/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/to-nexus/ant/actions/workflows/ci.yml/badge.svg"></a>
  <a href="README.ko.md"><img alt="Korean" src="https://img.shields.io/badge/lang-한국어-red"></a>
  <a href="docs/local-mode/install.md"><img alt="Quickstart" src="https://img.shields.io/badge/docs-quickstart-success"></a>
</p>

<p align="center">
  <img src="docs/assets/code-job.webp" width="880"
       alt="A directive decomposed into fourteen tasks on Ant's board, then documents and token files streaming into the workspace, then the board again with three tasks moved to Completed">
</p>
<p align="center"><sub>One directive → decomposed tasks running in parallel, each
writing a real file at a real path — read it, diff it, argue with it. Not just a
commit.</sub></p>

> ⚠️ **Status: pre-alpha, solo-developed.** It works end-to-end, but the public
> API and file layout will move until the first tagged release, and building this
> much breadth alone means some surfaces are thinner than others — see
> **[Maturity](#maturity)** for an honest per-feature breakdown. Issues and PRs
> are welcome; **[Contributing](#contributing)** says where help lands best.

---

## Why Ant?

Most AI coding tools are built around "vibe coding" — you tell the model
what you want, it writes some code, you tell it what's wrong, repeat. That
loop scales to demos and hobby projects, not to engineering.

Ant takes the opposite stance. We made two loops that respect how
engineering actually works.

**The build loop** — greenfield, once per project:

1. Write the **PRD**. The `planner` agent helps you clarify it.
2. Generate the **system design** (architecture, API contracts, system docs).
3. Design the **UI** (or **game art** for the game domain) — generated from
   the PRD, or drop in your own Figma / Claude artifact
   (see [Bring your own design](#bring-your-own-design)).
4. Write **code** grounded in those designs.

**The iteration loop** — every change after that:

5. Author a **spec** for the next unit of work, review it, and let a code
   job implement exactly that one spec (`spec → code`). If you've used plan
   mode in Claude Code, this is the same workflow — except the plan is a
   persistent document you can diff, review, and revise
   (`gen-spec` → `gen-code-spec` → `rev-spec` → repeat).

Verification is not a stage you schedule — it is a property of **every code
job**: work decomposes into tasks that run in parallel, and a final
verification task gates completion. Failed gates spawn error tasks that fix
and re-verify.

Each step is a separate job with its own prompt surface, its own tools, and
its own durable artifacts. The result is a system you can audit, not a
black box that occasionally writes code.

<p align="center">
  <img src="docs/assets/build-loop.png" width="880"
       alt="Two pipelines. The build loop, for greenfield or a major new feature, runs plan (plan/PRD.md) then system design (architecture/system/) then UI or game art (visual/ui/) then code (codebase/). The iteration loop, for every change after that, skips both plan and system design and runs spec (architecture/spec/) straight into code, with a rev-spec return arc">
</p>

---

## Quickstart

**Requires** Node.js >= 22.13 · pnpm 11.1.0 (`corepack enable && corepack prepare pnpm@11.1.0 --activate`) · Docker + Compose (for Redis) · an [LLM provider key](#providers).

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

Ant ships its own agent runtime, so there is **no router in the middle**.
Three adapter families — Anthropic, OpenAI-compatible, and Gemini — speak to
each vendor's API directly with your own key. You pay the provider's list
price: no per-token markup, no request metering, and your prompts never
transit a third party you didn't choose.

Two caveats worth knowing before you pick: DeepSeek, GLM, and Kimi are wired
through the OpenAI-compatible adapter rather than first-class clients, so
provider-specific features may lag. And **image generation is Google-only** —
the `visual` job needs `GEMINI_API_KEY` regardless of what you use elsewhere.

---

## Bring your own design

Ant accepts **three kinds of design input** as first-class citizens. You
don't pick a tool — you drop what you have:

<p align="center">
  <img src="docs/assets/design-input.png" width="880"
       alt="Three design inputs — Claude artifacts read observation-only from visual/ui/handoff/, a Figma URL fetched live over MCP, or nothing yet, in which case a design job authors the bundle — merging into one UI design contract that a code job builds against">
</p>

| Source               | What you drop                                   | When to use                                                              |
|----------------------|-------------------------------------------------|--------------------------------------------------------------------------|
| **Claude artifacts** | HTML/CSS/Markdown/PNG into `visual/ui/handoff/` | You've been iterating in Claude.ai. No license, no setup, no schema.     |
| **Figma**            | A Figma URL into `visual/ui/figma/figma.json`   | You have an existing Figma project. Live MCP exploration at prompt time. |
| **Nothing yet**      | Run a `design` job on your PRD                  | Greenfield. Ant authors the handoff bundle for you.                      |

The three sources are hard-exclusive per workspace and have different
interpretation contracts (Claude handoff is observation-only / FPOP, Figma
is live-fetched, ant-native JSON is schema-based).

**What a `design` job emits depends on where you started.** From a PRD
(`gen-ui-desc`) it writes a `DESIGN.md`-anchored bundle into `visual/ui/handoff/`
(`styles.css`, `tokens/`, `components/`, `screens/`, `assets/`). From
`figma.json` (`gen-ui-figma`) it writes the canonical trio `ui-tokens.json` +
`ui-assets.json` + `ui-spec.json` into `visual/ui/ant/`.

The full design-input guide is in
[docs/guides/design-input/](docs/guides/design-input/).

---

## How it works

<p align="center">
  <img src="docs/assets/architecture.png" width="880"
       alt="Ant's runtime topology — ant-ui and ant-site in the browser over one HTTP and SSE edge, then ant-api, ant-realtime and ant-preview, all talking through a Redis bus carrying Pub/Sub, BullMQ and state, with ant-job spawning one isolated job-runner child process per job, plus optional ChromaDB and visual-processor sidecars">
</p>

Four backend processes, one codebase, communicating over Redis only. Local mode
and cloud (Kubernetes) mode share the same data plane — local is just "all
processes on one machine".

Each job runs an agent **LangGraph** state machine: `resolve` → `triage` →
job-specific phases → `learn`. The UI draws that graph live, so you can watch
which node is executing and how many parallel workers it fanned out.

<p align="center">
  <img src="docs/assets/job-anatomy.png" width="880"
       alt="The graph a job runs — the architect, planner and creator agents with the jobs they own, then resolve, triage, detect and decompose, fanning out to setup, feature and ui tasks running in parallel, converging on a Final Verification task that can send work back before the job completes, then learn">
</p>

| Agent       | Jobs it owns                                  |
|-------------|-----------------------------------------------|
| `architect` | `code`, `design`, `learn`, `ask`, `inline-ask` |
| `planner`   | `plan`                                        |
| `creator`   | `visual`                                      |

One `design` job, three surfaces — the intent picks one: system design
(`gen-sys-*`), UI / game-art design (`gen-ui-*` / `gen-game-art-*`), or spec
authoring (`gen-spec` / `rev-spec`).

Read more: [docs/concepts/architecture.md](docs/concepts/architecture.md).

---

## Workspace model

A **project** has exactly one git repository: a hidden bare anchor at
`{project}/repo.git`. Every **feature** is an equal linked worktree at
`features/{feature}/codebase/`, and **the branch name is the feature name** —
no prefix, no sanitising. Feature names may contain `/`, so `feature/base` and
`release/1.0` work as you would expect.

<p align="center">
  <img src="docs/assets/workspace.png" width="880"
       alt="A project's hidden bare anchor at repo.git fanning out to three peer feature worktrees, each holding codebase/ plus plan/, architecture/, visual/ and assets/, with the branch name matching the feature name exactly">
</p>

A project with no features has no codebase. There is no privileged "main"
worktree — features are peers.

Alongside `codebase/`, each feature holds the artifacts the agents produce:
`plan/` (PRD), `architecture/` (system design + spec), `visual/` (UI and
game-art design), `assets/`, plus agent-internal `sessions/` and `meta/`.

Because features are equal worktrees, you can run several in parallel —
each with its own branch, its own checkout, its own preview server, and its
own artifact set — and merge them like any other branches.

---

## What it can build

| Domain                   | Status         | Examples                                     |
|--------------------------|----------------|----------------------------------------------|
| **Service** (web/backend)| Stable         | Full-stack SaaS, dashboards, REST APIs       |
| **Game**                 | Experimental   | Phaser/Web games with sprites + HUD + audio  |

See [Maturity](#maturity) for what "Experimental" means here in concrete terms.

The two domains share the same agents but ship different prompt overlays,
different design templates, and different visual-tier catalogs. Adding
new verticals is a domain-registry change — no fork required.

---

## Features

- **Spec-sized iteration.** Author a spec, review it, and a code job
  implements exactly that one spec — plan mode, except the plan is a
  persistent artifact you can diff and revise.
- **Drop-in Claude designs.** Paste your Claude.ai artifact (HTML/CSS/MD)
  into `visual/ui/handoff/` and Ant treats it as observable-only design
  source. No conversion, no schema. Often the single biggest reason teams
  switch from prompt-only tools.
- **Figma MCP.** Live exploration via the Figma MCP server at prompt time —
  nothing is snapshotted to disk. Design tokens are emitted into the canonical
  `visual/ui/ant/` trio.
- **Multi-agent pipeline.** Planner writes the PRD; architect generates the
  system design, the UI design, and the code. Every code job ends with a
  verification task that gates completion — failures spawn fix tasks and
  re-verify.
- **5 execution tiers.** From one-shot Q&A to refs-grounded multi-task
  projects, dispatched automatically based on the request.
- **Any stack.** Frontend, backend, or fullstack — the target language and
  framework are described by extensible tech tiers, not hard-coded into the
  prompts.
- **Service connections & virtualization.** Declare the external services
  your app talks to and Ant generates toggleable mock adapters, so the app
  runs and demos before the real backend exists.
- **Parallel features, live preview.** Each feature is a git worktree with
  its own branch and its own hot-reloading dev server — work several
  features at once, merge them like branches.
- **Browser IDE.** Launch VSCode with your codebase in one click — a Docker
  container locally, a Kubernetes Pod when `ANT_K8S_NAMESPACE` is set.
- **Interruptible & resumable.** Jobs checkpoint after every phase — stop
  it, crash it, or close the lid, and the job resumes where it stopped.
- **Hackable prompt surface.** Every agent prompt is a Handlebars template
  on disk, auto-registered at startup — tune the agents for your codebase
  ([guide](docs/guides/custom-prompts.md)).
- **Self-hosted, cost-transparent.** Bring your own LLM key from any of six
  providers — the runtime speaks Anthropic, OpenAI-compatible, and Gemini
  natively, straight to each vendor's endpoint with **no router markup** —
  and see per-model token / cost / cache-hit breakdowns for every job.

### What is cloud-only

The repository contains the seams for the managed service — billing/credits,
organizations, deploy, and custom domains. In a self-hosted deployment these
are **inert**: capability gates leave no-op implementations in place, and you
pay your LLM provider directly rather than buying credits. Nothing in the
self-host path phones home. CI enforces this — the build fails if a
cloud-only symbol reaches the open-source bundle.

---

## Maturity

Ant covers a lot of ground for a one-person project, and that breadth is
uneven. This table is the honest version. Nothing here is hidden in a changelog
footnote.

| Surface | Status | What that means in practice |
|---|---|---|
| `code` / `design` / `plan` jobs — service domain | **Stable** | The supported path. This is what gets used daily. |
| Live preview, browser IDE | **Stable** | Well covered by tests and exercised constantly. |
| Service connections & virtualization | **Beta** | Connection config, auto-detection, and mock adapters all ship and are tested. What's missing is a **verification gate proving a generated adapter matches the real service** — so test generated integration code against your actual backend before trusting it. |
| `creator` agent / `visual` job | **Experimental** | **Google Gemini only** — needs `GEMINI_API_KEY` no matter which provider you use elsewhere. Background removal needs an optional sidecar. **No mid-graph resume**: an interruption restarts the job. The graph nodes have no execution tests. |
| Game domain | **Experimental** | **Greenfield only** — the game-art tier is suppressed on existing codebases. Phaser only (3D is the `enable3d` extension, not a separate engine). The sprite-atlas hand-off between the design and visual jobs isn't closed, so production art is user-placed. |
| Vector DB / RAG (`learn` job) | **Experimental** | Wired end-to-end but **off by default — and we recommend leaving it off** (`ANT_VECTOR_DB_ENABLED=false`; needs a ChromaDB sidecar; hidden from the UI). The chunking / indexing strategy isn't tuned enough for indexing to pay off yet — the framework exists ahead of a future org-shared vector DB. Nothing degrades without it: retrieval is a 3-tier chain (vector → git-changes → keyword). The `learn` node itself still earns its keep with the DB off — it writes the LLM job summary and the session distillation every job ends with. |
| Team / org workspaces | **Not shipped** | Account switching works. Team creation and invites do not. |
| Managed cloud (billing, credits, deploy quota, custom domains) | **Not open** | Inert no-op seams in a self-hosted deployment. |

If something in the Experimental rows blocks you, say so in an issue — knowing
what people actually hit is more useful than a roadmap guess.

---

## Documentation

- **[Local Mode](docs/local-mode/)** — install + develop on your own machine (Persona A)
- **[Cloud Mode](docs/cloud-mode/)** — install + develop for managed (Persona B) or self-host cloud (Persona C)
- **[Concepts](docs/concepts/)** — architecture, agents, jobs, execution tiers, spec-driven philosophy
- **[Guides](docs/guides/)** — design input, custom prompts, observability
- **[Reference](docs/reference/)** — CLI, env vars, API, shared types
- **[First feature](docs/getting-started/first-feature.md)** — PRD → Design → Code walkthrough
- **[Troubleshooting](docs/getting-started/troubleshooting.md)** — install-time and runtime hiccups
- **[한국어 README](README.ko.md)** — Korean readme (docs are English-only)

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

**Ant is solo-developed.** One person wrote the agents, the prompts, the
frontend, and the docs, which means reviews are best-effort rather than
same-day, and the roadmap is a judgement call rather than a committee decision.
If a PR or issue has had no reply after a week, bump it — that's helpful, not
rude.

It also means outside help is genuinely useful. These are the places where a
contribution lands with the least required context:

| Area | Why it's a good entry point |
|---|---|
| **Docs** | Reading a doc and fixing what confused you is the highest-value first PR there is. Docs are English-only — Korean exists only as the top-level [README.ko.md](README.ko.md). |
| **LLM provider adapters** | Three of the six providers run through an OpenAI-compatible shim. Promoting one to a first-class client is well-scoped and self-contained. |
| **Tests for the `visual` job** | The `creator` agent's graph has no execution tests. Anything here is net-new coverage. |
| **Frontend tests** | `ant-ui` is thinly covered relative to the backend. |
| **Bug reports with a reproduction** | Reproductions are worth more than patches. A report that lets the bug be re-created is already most of the fix. |

Before a deep change to the agent graphs, open an issue first. The LangGraph
core carries invariants that aren't visible in a diff — a design conversation
up front saves a rewrite later.

Read [CONTRIBUTING.md](CONTRIBUTING.md) for setup and the PR workflow, and
[AGENTS.md](AGENTS.md) for the binding architectural rules. AGENTS.md matters
more than it looks: most of those rules have regression-guard tests behind
them, so violating one fails CI rather than review.

---

## License

Apache-2.0 — see [LICENSE](LICENSE). Third-party dependency notices are in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Contributions are accepted under the same license (Apache-2.0 §5). There is no
CLA to sign and no DCO sign-off required.

---

<p align="center">
  <sub>Ant is an open-source project. Star to follow along, file issues to
  shape it, send PRs to ship it.</sub>
</p>

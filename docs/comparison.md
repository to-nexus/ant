# Choosing between Ant and its neighbours

Honest comparison, written by Ant's author. Every tool below is good at what
it is actually for, several of them are more mature than Ant, and for many
readers the right answer is *not Ant*. The fastest way to a good decision is
the **"use it instead if"** column, not the feature matrix.

*Last reviewed: 2026-08. These projects move fast — check their repos for
current state.*

Ant has two wings and they have **different competitors.** The first three
sections compare the **codespace** — building software. If you came for the
**workspace** — work agents you define in files and run on a schedule — the
comparison set is a different industry, and it is
[further down](#if-you-came-for-the-work-agents).

## At a glance

| | What it is | Install model | Runs where |
|---|---|---|---|
| **Ant** | Self-hosted platform with two wings on one runtime: **build** — PRD → system design → UI → code → verification as a state machine; **operate** — work agents you define in files and run on a schedule. Both against a declared context set per job | Clone + pnpm + Docker (Redis), 6 processes | Your machine (or your k8s) |
| **spec-kit** | A spec-driven workflow (specify → plan → tasks) layered onto the coding agent you already use | `uvx`, integrates with 29+ agents | Inside your existing agent |
| **OpenSpec** | Lightweight spec / change-proposal workflow for existing agents, deliberately anti-ceremony | `npm i -g` | Inside your existing agent |
| **Claude Code** | General-purpose terminal coding agent with plan mode | `npm i -g` / installer | Your terminal |
| **OpenHands** | Autonomous software-dev agent that resolves tasks end-to-end | Docker | Container per task |
| **Lovable** | Hosted commercial prompt-to-app builder | None — browser | Their cloud |

## Use them instead if…

| Tool | Use it instead of Ant if… |
|---|---|
| **spec-kit** | You already live in Claude Code, Cursor, or Copilot and want a spec-driven workflow **without running any infrastructure**. It is the category leader for exactly that, and nothing in Ant will beat a zero-install folder if that's the shape you want. |
| **OpenSpec** | You want specs as lightweight change proposals with minimal ceremony, inside the agent you already use. If Ant's phase gates sound like friction rather than safety to you, OpenSpec's philosophy is the one you'll enjoy. |
| **Claude Code** | Your daily work is an **existing, large codebase** and you want the strongest general-purpose agent with maximum flexibility. Ant is product-pipeline-shaped (greenfield builds and spec-sized iteration); it is not a drop-in Copilot replacement and doesn't try to be. |
| **OpenHands** | You want an autonomous agent that takes an issue and resolves it end-to-end in a sandbox, benchmark-style. Ant never optimizes for SWE-bench-shaped work. |
| **Lovable** | You want an app **now**, in the browser, with hosting handled and zero setup. Ant's trade — your machine, your keys, your git, your process — costs an install that Lovable simply doesn't have. |

## Use Ant's codespace if…

- **You want to see what enters the model's context — before the run.** Each
  job executes against a declared artifact set; a binding runtime rule forbids
  wholesale-walking the workspace into the prompt, and the chat transcript is
  structurally separate from the LLM context (jobs get a bounded 4–12k-token
  distillation, never the scrollback).
- **You want costs itemized and bounded.** Hard token budgets per channel, and
  a per-model token / cost / cache-hit breakdown at the end of every job.
- **You want the process to be inspectable files, not vibes.** PRD, system
  design, UI design contract, spec, and verification results all land at real
  paths you can read, diff, and revise — and every code job is gated by a
  verification task, not by optimism.
- **You want to self-host with your own keys.** Three adapter families speak
  directly to Anthropic / OpenAI-compatible / Gemini endpoints. No router, no
  markup, no third party you didn't choose.
- **You run several features in parallel.** Each feature is a git worktree
  with its own branch, preview server, and artifact set.

## If you came for the work agents

A **workspace** is the other project kind: you define an agent and its jobs as
files, connect the systems it may reach over MCP, and either run a job from the
composer or let a cron-triggered pipeline run it for you. That competes with
workflow automation and hosted-agent products, not with coding agents.

| | What it is | Where it runs |
|---|---|---|
| **Ant (workspace)** | Work agents defined as yaml + prose files; capability comes only from MCP servers you own; cron-scheduled chains with approval and clarify gates | Your machine (or your k8s) |
| **n8n** | Mature visual workflow automation, huge connector catalog, webhook + schedule triggers, AI nodes on top | Self-host or their cloud |
| **Dify / Flowise** | GUI-first LLM app and agent builders with RAG included | Self-host or their cloud |
| **Zapier Agents / OpenAI AgentKit** | Hosted agents wired to a vendor connector catalog | Their cloud |
| **Claude Projects / custom GPTs** | A shared persona plus files, inside a chat product | Their cloud |
| **LangGraph / CrewAI / AutoGen** | Frameworks for building an agent system in code | Wherever you deploy it |

### Use them instead if…

| Tool | Use it instead of Ant if… |
|---|---|
| **n8n** | You need **webhook or event triggers**, hundreds of ready-made connectors, or delivery into Slack and email. Ant's triggers are cron and run-now only, its steps are agent jobs rather than connectors, and it has no notification channels — n8n is simply the better tool for integration-shaped automation, and it is far more mature. |
| **Dify / Flowise** | You would rather assemble an agent by dragging boxes than by writing files. Ant's definitions are yaml and prose you review in a pull request; if that sounds like friction rather than auditability, a GUI builder will make you happier. |
| **Zapier Agents / OpenAI AgentKit** | You want agents **now**, with no infrastructure, and you are comfortable with a vendor's cloud holding your credentials and your prompts. Ant's trade — your machine, your keys, your secret store — costs an install these don't have. |
| **Claude Projects / custom GPTs** | A shared persona in a chat window is genuinely all you need. Zero setup beats everything below, and you give up self-hosting, scheduling, and MCP-declared capability to get it. |
| **LangGraph / CrewAI / AutoGen** | You are building an agent *system* and want a library to build it with. Ant is the opposite trade: the harness is fixed and you supply judgment as prose. If you want to own the control flow, own it — don't take Ant's. |

### Use Ant's workspace if…

- **A definition has to be reviewable.** An agent is files: you diff it, review
  it in a PR, and roll it back. There is no GUI-only state and no export step.
- **Capability must come from a system you own.** MCP is the *only* way to add a
  tool — the builtin list can be narrowed, never extended. So the rule that must
  hold (a refund ceiling, a send limit, a permission check) lives in your server,
  which decides *whether*; the model only decides *when*. Prompts specialize
  judgment; they cannot guarantee behavior.
- **Secrets must not sit in a config file.** Credentials are `${secret:KEY}`
  references into an AES-256-GCM per-user store. A definition cannot name one of
  Ant's own environment variables, and a stdio server's child process sees only
  what it declared.
- **You want a human in the loop.** Approval gates and clarify questions park a
  run until someone answers, rather than optimizing for full autonomy.
- **One runtime should do both jobs.** The same processes, bus, prompt surface,
  and credential store that build your product also run your process. That is the
  one thing on this page no other tool offers.

Concepts: [concepts/custom-agents.md](concepts/custom-agents.md) ·
[concepts/pipelines.md](concepts/pipelines.md) · build one:
[guides/custom-agent-authoring.md](guides/custom-agent-authoring.md).

## What Ant costs you (the honest part)

- **A real install.** Node 22+, pnpm, Docker for Redis, six processes. Every
  tool above except OpenHands is lighter to try.
- **Pre-alpha, solo-developed.** Breadth is uneven — the per-surface truth is
  in the [Maturity table](../README.md#maturity), and it stays honest.
- **Process has a price.** The declared-context model is why runs are
  auditable, but it also means Ant asks you to work in jobs and specs rather
  than free-form chat. If you don't feel the pain that solves — context you
  can't predict, bills you can't predict, runs you can't reproduce — a lighter
  tool will make you happier.
- **The work-agent wing is younger than the rest.** It is Experimental:
  triggers are cron and run-now only, pipelines run on workspace projects only,
  there is no Slack or email delivery, and a gated write is refused rather than
  prompting you to approve it. See the
  [Maturity table](../README.md#maturity) for the per-surface truth.
- **Team features are new.** Team organizations, invites, the
  owner/admin/member ladder, and org-shared agent and pipeline definitions ship,
  but they arrived recently and have seen far less use than the single-account
  path. MCP credentials stay per-user by design, so sharing a definition does not
  share its secrets.

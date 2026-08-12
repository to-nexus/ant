# Choosing between Ant and its neighbours

Honest comparison, written by Ant's author. Every tool below is good at what
it is actually for, several of them are more mature than Ant, and for many
readers the right answer is *not Ant*. The fastest way to a good decision is
the **"use it instead if"** column, not the feature matrix.

*Last reviewed: 2026-08. These projects move fast — check their repos for
current state.*

## At a glance

| | What it is | Install model | Runs where |
|---|---|---|---|
| **Ant** | Self-hosted platform: PRD → system design → UI → code → verification as a state machine, with a declared context set per job | Clone + pnpm + Docker (Redis), 6 processes | Your machine (or your k8s) |
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

## Use Ant if…

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
- **No team features yet.** Account switching works; team creation and invites
  don't. Use git.

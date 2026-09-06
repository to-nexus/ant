# 48 — AX Positioning: Why the Universal Agent + Pipeline System Exists

> Decision record, 2026-09. Not marketing. This documents why Ant keeps its own
> agent runtime next to Claude Code, what we compared, what we decided, and what
> costs we knowingly accept. Read it before proposing a runtime replacement or a
> workflow-tool-style feature (assignees, approval chains, roles).

## The question

Claude Code (and the Claude Agent SDK) already exists. Ant was started because
teams need agents that run **in the org's own cloud, shared per department,
operated from a browser** — not installed per developer machine. Given that
Anthropic has since shipped Claude Code on the web, scheduled Routines, Slack
integration, plugins/marketplaces, and managed enterprise settings (all GA as of
2026-09), is the universal agent + pipeline system still the right vehicle?

## Comparison findings (2026-09)

Mapping Ant concepts onto Claude Code:

| Ant | Claude Code | Verdict |
|---|---|---|
| `intents/{id}/infer.md` + `prompt.md` | Skill `description` frontmatter + SKILL.md body | Near-isomorphic. Both are progressive disclosure with model self-selection. |
| `on-demand/**` (paths-only index, `read_file` on demand) | Skill supporting files | Same idea. |
| `hooks.yaml` stop hooks | **Not** CC hooks. Closest: `/goal` + Stop hook | Different by design — see "Hooks doctrine" below. |
| `tools.builtin` / `tools.approval` / sandbox / plan-turn confinement | CC hooks' policy-gating half (PreToolUse) + permission settings | Same function, declarative instead of programmable. Correct for a multi-tenant worker. |
| `explore`/`subagent_report` | Subagents (personas, background, worktrees, teams) | Ant is far thinner here. |
| `pipeline.yaml` v2 (cron, DAG, verdict routing, approval gates, clarify HITL, retry/timeout, availability state machine, run JSONL audit) | **No counterpart.** Routines are single-prompt autonomous sessions with no gates, no DAG, no org inbox | Ant-unique. |
| — | `/goal`, checkpoints/rewind, plugin marketplaces, agent teams, deep coding harness | CC-unique. |

Two asymmetries fall out:

1. **CC = thick runtime, thin declarations, policy-only org story.** Managed
   settings restrict what individuals may do; they do not give an org a shared
   operating surface. The Agent SDK's official position is that multi-tenant
   auth/session routing is the integrator's problem.
2. **Ant = thin runtime, thick control plane.** The universal graph is
   deliberately a linear 4-node loop (doc 44). The definition/activation/run
   layer — scopes, ACL, promote, availability state machine, HITL inbox,
   `human_resolved` audit lines, per-user encrypted credentials — is the part
   Anthropic does not sell.

"No install, runs in the cloud" is **no longer a moat by itself** (Claude Code
on web is GA). The moats that survive:

- **Data sovereignty** — Ant self-hosts in the org's own VPC; every Anthropic
  surface runs on Anthropic infrastructure.
- **The org control plane** — shared definitions, activation, gated runs,
  audit. No Anthropic product occupies this layer.
- **Model sovereignty** — the provider adapter (anthropic/openai/gemini-compat,
  in-house open-weight next) decouples the platform from any one vendor's
  pricing and availability.

## Decisions

### D1 — The runtime stays in-house, and stays deliberately thin

Replacing the universal loop with the Claude Agent SDK was evaluated and
**rejected**. The SDK's value is riding Anthropic's harness improvements, which
is only realized on Claude models; Claude API economics are ruled out for
runtime traffic. Pointing the SDK at compat proxies (GLM/QWEN) is an
unsupported configuration that surrenders parser ownership — the ability to fix
model idiosyncrasies (tool-call markup leakage, drain/recursion pathologies)
in our own loop is exactly how those incidents were resolved. The multi-provider
adapter is not debt; it is the model-sovereignty moat.

Corollary: the runtime's thinness is a feature. It caps maintenance cost,
keeps a future swap seam narrow if economics ever change, and pushes quality
investment where it compounds (D2). Do not grow the universal graph toward the
code-job graph (no tiers, no task queue, no classification pass — doc 44).

### D2 — Quality comes from contracts, not from the model

The bet that makes an open-weight runtime viable: a turn's success is never
self-declared by the LLM. Stop hooks demand observed tool evidence re-verified
on disk; verdict vocabularies route pipeline edges; gates park work for humans.
Contract-side investment (hook validation ladder, catalog binding proofs,
authoring loops) is the standing priority over runtime features.

### D3 — The target AX model: the pipeline is the assignee

Ant's automation model is **work flows autonomously; humans are exception
handlers** — a person is pulled in only at clarify/approval points, told
exactly what to decide, and the flow continues. It is *not* a workflow
management tool: no Jira-style assignee routing, no approval-chain/role
system, no per-task human ownership. Feature proposals in that direction
should be rejected unless the exception-handler model demonstrably fails.

What the model does require (the gaps, in priority order):

1. **In-app approver authority** — today only the activator can resolve any
   HITL (resolve routes 404 on any other caller), so the "someone authorized
   presses the button" set has size 1. Widening it is a guard change on the
   single resolve funnel plus an `approvers` list on the activation — not a
   role system. Note the coupling: any external notification channel makes
   the presser ≠ activator, so notification and non-activator authority are
   one feature, in-app first.
2. **Activation ownership transfer** — a personal account owning departmental
   infrastructure expires on offboarding (`membership-revoked` per step, and
   only the departed activator can deactivate). The classic service-account
   problem; the minimal fix is ownership transfer.
3. **Sandboxed `command:` validation hooks** — the one substantive gap vs CC
   hooks (see D4); weight rises as runs become unattended.
4. **Org-level credential store** — today every activator pastes their own
   copy of a departmental key.
5. **Event triggers** (inbound webhook) — when reactive workflows arrive;
   cron covers the calendar-driven pilots.
6. Only then: parallel step dispatch (Phase 3), cross-run reporting.

### D4 — Hooks doctrine: observe, don't execute — with one planned extension

CC hooks bundle two functions. The policy-gating half exists in Ant as
declarative tool policy (correct for a multi-tenant worker: author shellcode on
shared infrastructure is an RCE/exfiltration surface; declarative policy is
auditable). The run-something-on-event half is Ant's one real gap: stop hooks
verify *existence and action evidence*, not artifact *content*. The planned
answer is the reserved `command:` hook executed inside the job's own sandbox
under the same `run_command` containment — not CC-style lifecycle shell hooks.
The trust argument already holds: that sandbox already executes LLM-chosen
commands; an author-chosen validation command at stop time is not a new trust
surface.

## Accepted costs

- No subagent personas, plan mode, checkpoints, skill ecosystem, or free
  harness improvements. Full maintenance burden, plus the model-floor work the
  quality loops exist for.
- Until service accounts exist: execution, billing, and HITL authority are
  per-user even for org-shared definitions.
- Authoring correct pipelines is expert work (doc 46 §8); the builder agents
  and their report contracts are the mitigation, not a solved problem.

## Pointers

- Runtime invariants: [44-universal-job.md](44-universal-job.md)
- Scheduling/HITL mechanics: [46-pipeline-scheduling.md](46-pipeline-scheduling.md)
- The in-app approver plan (gap 1): `docs/tmp/2026-09-06-plan-inapp-approver.md`

# Internals

> ⚠️ **Contributor-only.** These documents describe Ant's internal SSOT
> policies, regression-driven invariants, and incident-grade rationales.
> They are intended for people **modifying Ant itself**.
>
> If you are using Ant to build software, read [`docs/concepts/`](../concepts/)
> instead — it covers the same material at a user-facing level.

## What lives here

This is the long-form SSOT for runtime architecture. Each document is
the authoritative source for one subsystem and is referenced by code
comments, regression tests, and PR review checklists.

The minimum starting reading list for new contributors:

1. [00-system-overview.md](00-system-overview.md) — process topology
2. [01-shared-contracts.md](01-shared-contracts.md) — `@ant/shared` types
3. [02-infrastructure.md](02-infrastructure.md) — Redis keys, BullMQ
4. [10-job-lifecycle.md](10-job-lifecycle.md) — how a job runs
5. [11-agent-architecture.md](11-agent-architecture.md) — LangGraph agents
6. [13-prompt-system.md](13-prompt-system.md) — PromptBuilder + 4-tier
7. [NODE_GRAPH_LAYOUT.md](NODE_GRAPH_LAYOUT.md) — R1–R5 layout invariants

For binding rules with regression-guard test names, see
[AGENTS.md](../../AGENTS.md) at the repo root.

## Document index

### Foundation

- [00-system-overview.md](00-system-overview.md)
- [01-shared-contracts.md](01-shared-contracts.md)
- [02-infrastructure.md](02-infrastructure.md)

### Job execution pipeline

- [10-job-lifecycle.md](10-job-lifecycle.md)
- [11-agent-architecture.md](11-agent-architecture.md)
- [12-triage-routing.md](12-triage-routing.md)
- [13-prompt-system.md](13-prompt-system.md)
- [14-code-job.md](14-code-job.md)
- [15-design-job.md](15-design-job.md)
- [16-planner-job.md](16-planner-job.md)
- [17-ask-system.md](17-ask-system.md)
- [17-code-verification-task.md](17-code-verification-task.md)
- [18-session-redesign.md](18-session-redesign.md)
- [18-visual-job.md](18-visual-job.md)
- [19-tool-system.md](19-tool-system.md)

### Runtime environment

- [20-workspace-isolation.md](20-workspace-isolation.md)
- [21-realtime-system.md](21-realtime-system.md)
- [22-preview-system.md](22-preview-system.md)
- [23-cloud-ide.md](23-cloud-ide.md)
- [24-git-operations.md](24-git-operations.md)
- [25-design-pipeline.md](25-design-pipeline.md)
- [26-figma-integration-infra.md](26-figma-integration-infra.md)
- [27-visual-processor.md](27-visual-processor.md)
- [28-context-management.md](28-context-management.md)
- [29-debug-logging.md](29-debug-logging.md)

### Frontend

- [30-frontend-architecture.md](30-frontend-architecture.md)
- [31-chat-system.md](31-chat-system.md)

### Cross-cutting policies

- [32-action-activation-policy.md](32-action-activation-policy.md)
- [33-visual-tier.md](33-visual-tier.md)
- [34-conversations.md](34-conversations.md)
- [35-codebase-meta-policy.md](35-codebase-meta-policy.md)
- [35-token-usage-tracking.md](35-token-usage-tracking.md)
- [36-output-tag-matrix.md](36-output-tag-matrix.md)
- [36-prompt-document-constraint-map.md](36-prompt-document-constraint-map.md)
- [37-auth-unified-procedure.md](37-auth-unified-procedure.md)
- [38-service-virtualization.md](38-service-virtualization.md)
- [39-code-job-prompt-injection-matrix.md](39-code-job-prompt-injection-matrix.md)

### Layout

- [NODE_GRAPH_LAYOUT.md](NODE_GRAPH_LAYOUT.md) — phase / router / parallel
  / hooks layout invariants.
- [ui-async-policy.md](ui-async-policy.md) — frontend async UI policy.

## Conventions

These documents:

- Are **English** (translated to Korean only when explicitly mirrored).
- Cite **incident codenames** that map to in-tree regression tests.
- Use **enforcement code blocks** so reviewers can grep for violations.
- Are **versioned alongside the code** — when a policy changes, the
  doc and the implementation move in the same PR.

If you change a runtime invariant without updating the matching internals
doc, expect a PR review comment requesting the update.

## How this relates to AGENTS.md

[AGENTS.md](../../AGENTS.md) is the **public** distillation. It lists the
binding rules in compact form for quick reference and onboarding (human
or AI). Every rule there links back to one or more documents here for
the full rationale.

Think of it as: AGENTS.md is the cheat sheet, internals is the textbook.

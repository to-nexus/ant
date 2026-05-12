# Ant Documentation

Welcome. The docs are organized into four tiers based on what you want to do.

| You are…                                          | Read                                                |
|---------------------------------------------------|-----------------------------------------------------|
| New to Ant — want to try it (local)               | **[Local Mode](local-mode/)**                       |
| Deploying for a team (managed or self-host)       | **[Cloud Mode](cloud-mode/)**                       |
| Trying to understand how it works                 | **[Concepts](concepts/)**                           |
| Customizing / integrating                         | **[Guides](guides/)**                               |
| Looking up an API / env var / file format         | **[Reference](reference/)**                         |
| Contributing to Ant itself                        | **[Internals](internals/)** + [AGENTS.md](../AGENTS.md) |
| Reading in Korean                                 | **[한국어](ko/)**                                    |

## Documentation map

```
docs/
├── local-mode/         Install + develop on your own machine (Persona A)
├── cloud-mode/         Install + develop for managed (Persona B) or self-host (Persona C)
├── getting-started/    First-feature walkthrough, troubleshooting
├── concepts/           Architecture, spec-driven philosophy, agents, jobs, tiers
├── guides/             Design input, custom prompts, observability
│   └── design-input/   The killer feature: Claude / Figma / native design sources
├── reference/          CLI, env vars, API, shared types, Redis keys
├── internals/          Contributor deep-dives — incident-grade SSOT documents
├── infra/              Long-form EKS / K8s runbook (DevOps audience)
├── observability/      Logging, metrics, debugging
├── rubric/             Evaluation rubrics for AI-generated code / PRD / design
├── testing/            Test strategy, e2e runbook, verification scenarios
└── ko/                 Korean mirror (selected docs)
```

## Where to start

- If you have **30 minutes**: read [local-mode/install.md](local-mode/install.md)
  and run [getting-started/first-feature.md](getting-started/first-feature.md).
- If you have **an hour**: also read [concepts/architecture.md](concepts/architecture.md)
  and [concepts/spec-driven.md](concepts/spec-driven.md).
- If you are **deploying to production**: start at
  [cloud-mode/install.md](cloud-mode/install.md); the long-form EKS runbook is
  [infra/cloud-deployment-guide.md](infra/cloud-deployment-guide.md).
- If you are **modifying Ant itself**: read [AGENTS.md](../AGENTS.md) first;
  then [develop.md](develop.md) and [internals/](internals/).

## Conventions

- All template / prompt examples in the docs are **English only** even on
  Korean pages. Prompts are part of Ant's runtime behaviour and must stay in
  English. See [AGENTS.md § Prompt Engineering](../AGENTS.md#prompt-engineering).
- Cross-references use relative links from the `docs/` root.
- Code blocks specify the language. Shell snippets default to `bash`.

## Found a problem?

Documentation issues are bugs. Open an issue with the
[bug-report template](../.github/ISSUE_TEMPLATE/bug_report.yml) and label it
`docs`, or send a PR — small docs PRs are very welcome.

# Ant Documentation

Welcome. The docs are organized into four tiers based on what you want to do.

| You are…                                          | Read                                                |
|---------------------------------------------------|-----------------------------------------------------|
| New to Ant — want to try it (local)               | **[Local Mode](local-mode/)**                       |
| Deploying for a team (managed or self-host)       | **[Cloud Mode](cloud-mode/)**                       |
| Trying to understand how it works                 | **[Concepts](concepts/)**                           |
| Customizing / integrating                         | **[Guides](guides/)**                               |
| Building work agents for your team or org         | **[Custom agents](concepts/custom-agents.md)** + [authoring guide](guides/custom-agent-authoring.md) |
| Running those agents unattended, on a schedule    | **[Pipelines](concepts/pipelines.md)**              |
| Looking up an API / env var / file format         | **[Reference](reference/)**                         |
| Contributing to Ant itself                        | **[Internals](internals/)** + [AGENTS.md](../AGENTS.md) |

Korean is available for the top-level [README.ko.md](../README.ko.md) only;
all docs under `docs/` are English.

## Documentation map

```
docs/
├── local-mode/         Install + develop on your own machine (Persona A)
├── cloud-mode/         Install + develop for managed (Persona B) or self-host (Persona C)
├── getting-started/    First-feature walkthrough, troubleshooting
├── concepts/           Architecture, spec-driven philosophy, agents, jobs, tiers,
│                       codespace vs workspace, custom agents, pipelines
├── guides/             Design input, custom prompts, custom agents, observability
│   └── design-input/   The killer feature: Claude / Figma / native design sources
├── reference/          CLI, env vars, API, shared types, Redis keys
├── internals/          Contributor deep-dives — incident-grade SSOT documents
├── rubric/             Evaluation rubrics for AI-generated code / PRD / design
└── testing/            Test strategy, e2e runbook, verification scenarios
```

## Where to start

- If you have **30 minutes**: read [local-mode/install.md](local-mode/install.md)
  and run [getting-started/first-feature.md](getting-started/first-feature.md).
- If you have **an hour**: also read [concepts/architecture.md](concepts/architecture.md)
  and [concepts/spec-driven.md](concepts/spec-driven.md).
- If you are **deploying to production**: start at
  [cloud-mode/install.md](cloud-mode/install.md).
- If you are **modifying Ant itself**: read [AGENTS.md](../AGENTS.md) first;
  then [develop.md](develop.md) and [internals/](internals/).

## Conventions

- The docs are **English only** (Korean exists only as the top-level
  [README.ko.md](../README.ko.md)). Prompt/template examples must stay in
  English in any case — prompts are part of Ant's runtime behaviour. See
  [AGENTS.md § Prompt Engineering](../AGENTS.md#prompt-engineering).
- Cross-references use relative links from the `docs/` root.
- Code blocks specify the language. Shell snippets default to `bash`.

## Found a problem?

Documentation issues are bugs. Open an issue with the
[bug-report template](../.github/ISSUE_TEMPLATE/bug_report.yml) and label it
`docs`, or send a PR — small docs PRs are very welcome.

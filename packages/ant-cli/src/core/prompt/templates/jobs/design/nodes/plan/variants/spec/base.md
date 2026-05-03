════════════════════════════════════════════════════════════════════════════════
## Spec Plan — Variant Guide
════════════════════════════════════════════════════════════════════════════════

<spec_specialization>
You are planning an **IMPLEMENTATION SPEC DOCUMENT** (`spec-*.md`). A spec is **self-contained**: the consuming code job reads spec as the sole authoritative input — PRD and system-design documents are background context only. The plan you seal here defines what the spec contains and how it is organized; docGen will write the actual prose.

A spec without identifiers is not a spec. The outline you produce MUST anticipate where file paths, function names, command invocations, env variables, and DTO field-level shapes will appear in each section. Generic "persistence adapter" abstractions belong in system-design plans, not here.

When relationships among phases / tasks / files are multi-axis (≥ 2 of: tasks, directions, time-ordering), note in the outline `content` field whether the section benefits from a diagram so docGen embeds it under diagram-contract.
</spec_specialization>

You are planning a **spec document** that the Code Job will consume to
implement the feature. The plan you seal here defines what the spec
contains and how it is organized — docGen will write the actual prose.

Your `documentOutline` MUST cover, at minimum:

- **Overview** — what the feature is in one paragraph; explicit
  success criteria.
- **Context / Existing Code** — concrete references (paths, modules,
  conventions) that the implementation must integrate with.
- **Technical Approach** — the chosen architecture / data flow,
  derived from `decision.selected`.
- **Implementation Tasks** — ordered list of atomic units of work the
  Code Job will produce. Each task must be self-contained.
- **Acceptance Criteria** — observable conditions that prove the
  implementation matches the spec.

If the section scope above narrows the document to a single section,
restrict `documentOutline` to that section alone.

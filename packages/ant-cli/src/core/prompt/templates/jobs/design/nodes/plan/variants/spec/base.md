════════════════════════════════════════════════════════════════════════════════
## 📐 Spec Plan — Variant Guide
════════════════════════════════════════════════════════════════════════════════

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

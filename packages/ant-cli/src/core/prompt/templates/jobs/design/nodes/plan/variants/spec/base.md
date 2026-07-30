════════════════════════════════════════════════════════════════════════════════
## Spec Plan — Variant Guide
════════════════════════════════════════════════════════════════════════════════

<spec_specialization>
You are planning an **IMPLEMENTATION SPEC DOCUMENT** (`spec-*.md`). A spec is **self-contained**: the consuming code job reads spec as the sole authoritative input — PRD and system-design documents are background context only. The plan you seal here defines what the spec contains and how it is organized; execute will write the actual prose.

A spec without identifiers is not a spec. The outline you produce MUST anticipate where file paths, function names, command invocations, env variables, and DTO field-level shapes will appear in each section. Generic "persistence adapter" abstractions belong in system-design plans, not here.

The converse ceiling also binds: the outline plans contracts — identifiers, signatures, shapes, ordering, verification gates — never implementation bodies. A section whose `content` promises full component/function code is over-deep; promise the signature and the acceptance gate instead. The body is the code job's output.

When relationships among phases / tasks / files are multi-axis (≥ 2 of: tasks, directions, time-ordering), note in the outline `content` field whether the section benefits from a diagram so execute embeds it under diagram-contract.
</spec_specialization>

You are planning a **spec document** that the Code Job will consume to
implement the feature. The plan you seal here defines what the spec
contains and how it is organized — execute will write the actual prose.

{{#if (eq detectedMode "refactor")}}
### Revision Plan (refactor mode)

The object of this plan is the EXISTING document injected above as
`# Existing Document (revision target)`. The user directive is a delta
applied to that document — NOT a brief for a new document.

- Enumerate EVERY existing section and assign each a disposition:
  - `keep` — preserved verbatim in the revised document; do not
    re-plan its content.
  - `modify` — state the exact delta this revision applies.
  - `remove` — only when the user directive sanctions the removal.
  - `add` — a new section the directive requires.
- `documentOutline` = the revised structure of the EXISTING document.
  Every existing section appears as an outline entry carrying an
  additional `"disposition"` field:
  `{ "section": "...", "content": "...", "disposition": "keep" | "modify" | "remove" | "add" }`
  (for `keep`, `content` may simply say "preserved verbatim").
- An outline that omits an existing section without a `remove`
  disposition is INVALID — content the directive does not affect must
  survive the revision.
- An existing `Directive Q&A` section is directive-scoped: disposition
  `modify` when the CURRENT directive embeds questions (replace its body),
  `remove` when it does not — that removal is always sanctioned.
{{else}}
Your `documentOutline` MUST cover, at minimum:

- **Overview** — what the feature is in one paragraph; explicit
  success criteria.
- **Context / Existing Code** — concrete references (paths, modules,
  conventions) that the implementation must integrate with.
- **Technical Approach** — the chosen architecture / data flow,
  derived from `decision.selected`.
- **Implementation Tasks** — ordered list of atomic units of work the
  Code Job will produce. Each task must be self-contained.
- **Acceptance Criteria** — the SYNTHESIZED set of distinct, observable
  conditions that prove the implementation matches the spec. Author these
  per Requirement Synthesis below: group related directive items, resolve
  contradictions to one condition, and let the count reflect distinct
  verifiable outcomes — NOT the directive's item count.

When the directive embeds explicit questions addressed to you, additionally
plan a tail `Directive Q&A` section (contract below) as the final outline entry.

If the section scope above narrows the document to a single section,
restrict `documentOutline` to that section alone.
{{/if}}

{{> jobs/design/base/injections/requirement-synthesis}}

{{> jobs/shared/injections/directive-qa}}

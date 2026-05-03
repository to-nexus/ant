### Spec Plan — Variant Rules

**RCA discipline**: When the directive describes a defect or failing
behavior, your candidate solutions MUST root-cause the problem before
proposing fixes. List at least two candidate root causes in
`candidateSolutions` (e.g. "data-shape mismatch at boundary A", "race
in caller B") and pick the one your exploration supports.

**Verification plan per candidate**: For each candidate, document the
observation that would prove it correct (`search_code` query,
`read_file` target, `search_web` query) — even if you choose to skip
the verification this round. docGen will not redo this analysis; the
plan is the place to surface uncertainty.

**Implementation Tasks granularity**: Tasks in `documentOutline` for
the "Implementation Tasks" section must each be:

- **Atomic** — completable in one Code Job task.
- **Specific** — names the file or module that changes and the
  observable behavior change.
- **Ordered** — earlier tasks do not depend on later ones.

**External APIs**: When the spec involves third-party integration,
your `documentOutline` MUST include a section that records the verified
API surface (endpoints, auth, rate limits). docGen records the values;
plan decides that the section exists and what shape it takes.

**Self-contained spec principle**: The Code Job has access only to the
written spec — it does NOT see your plan, the Figma file, or the
PRD. Your `documentOutline` MUST plan for every observed fact that the
Code Job will need (asset paths, design tokens, component states) to be
recorded directly in the spec. Plan the section; docGen writes the
values.

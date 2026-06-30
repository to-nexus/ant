## Framework Grounding — React

**Applies when**: a React (non-Next.js) frontend is the grounded codebase.

When the spec/design is grounded on an existing React codebase, anchor decisions in the app's observed composition rather than a generic SPA model. Inspect before asserting.

---

### Composition & data flow

**Principle**: Behavior is partitioned across rendering, state, and I/O layers that the spec must name separately.

- Where rendering lives (components) vs where state lives (store / context / hooks) vs where I/O lives (API client / data-fetching layer). Observe the existing split before specifying a new feature's placement.
- The routing mechanism in use (router library + route table location) — the spec references route entries, not framework internals.

### Boundaries

**Principle**: Each boundary has one responsibility and an explicit import direction.

| Boundary | Owns | Must NOT contain |
|---|---|---|
| Components | Presentation, local UI state | Business rules, direct I/O |
| State layer | Cross-component state, orchestration | Rendering markup |
| I/O / data layer | Server communication, caching | UI concerns |

### What the spec owns vs defers

Specify the feature's boundary placement, the data contract it consumes, and the state it owns. Do NOT author component code or restate React APIs (hooks, effects) — name *what* and *where*; the code job decides *how*.

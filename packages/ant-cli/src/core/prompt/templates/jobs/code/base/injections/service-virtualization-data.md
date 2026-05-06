## Service Virtualization — Fake Data Realism

### Principle

**When a virtualized adapter is active, the data it returns MUST be
plausible within the project's domain — never literally "test1 / test2"
or filler placeholder strings. A demo built on virtualized data is the
user's first proof that the application is correct end-to-end before
real backends arrive.**

This partial governs the FAKE body fields a virtualized adapter emits:
text, number, date, id, and relation fields. Image fields defer to the
sibling `service-virtualization-imagery` partial.

### Observation Targets

For every operation a virtualized adapter exposes, decide each axis below
before authoring the body:

| Axis | Question | Constraint |
|---|---|---|
| Domain fit | What category does this entity belong to in the directive / design doc? | Mock names / labels / shapes mirror the project's domain vocabulary |
| Determinism | Does re-rendering the same scenario yield the same data? | Derive values from a stable seed (entity id / index / hash) — never `Math.random()` per render |
| Quantity coverage | What state coverage does the surface need? | Provide enough fake records to render: empty / one / a handful / a long list — match the surface that consumes them |
| Cross-entity invariant | Do entities reference each other? | Foreign-key style invariants MUST hold (an order's user reference resolves to an actual user record) |
| Temporal plausibility | Are timestamps and durations human-believable? | Bound dates to a recent window, durations to plausible ranges; do NOT emit zero-epoch values |

### Constraints

- Do NOT emit filler placeholder strings or generic test labels
- Do NOT introduce a new faker / stub library when the project's manifest
  already declares one — reuse the existing pathway
- Do NOT randomize per render — that breaks reproducibility for any
  end-to-end demo built on the virtualized adapter
- The fake body table is part of the virtualized adapter's source — NOT a
  separate runtime fixture loaded from disk at boot

### Blind Spot

**Backend developers default to "id=1, name='test'"; frontend developers
default to filler prose.** Either result reads as broken software
regardless of how complete the production code is. Treat fake body
content as user-facing material — same diligence as production messaging.

### Image Subtype Routing

For image fields, defer to `service-virtualization-imagery`. This partial
owns text / number / date / id / relation fields only.

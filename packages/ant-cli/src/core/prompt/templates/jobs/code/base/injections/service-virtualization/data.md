## Service Virtualization — Fake Data Realism

### Principle

**When a virtualized adapter is active, the data it returns MUST be
plausible within the project's domain — never literally "test1 / test2"
or filler placeholder strings. A demo built on virtualized data is the
user's first proof that the application is correct end-to-end before
real backends arrive.**

This partial governs the FAKE body fields a virtualized adapter emits whose
purpose is to be **displayed or computed on**: text, number, date, id, and
relation fields. Two field kinds are OUT of scope and defer to a sibling: image
fields defer to `service-virtualization-imagery`; **navigable-target fields**
(below) defer to `service-virtualization-contract`.

### Observation Targets

For every operation a virtualized adapter exposes, decide each axis below
before authoring the body:

| Axis | Question | Constraint |
|---|---|---|
| Domain fit | What category does this entity belong to in the directive / design doc? | Fake names / labels / shapes mirror the project's domain vocabulary |
| Determinism | Does re-rendering the same scenario yield the same data? | Derive values from a stable seed (entity id / index / hash) — never `Math.random()` per render |
| Quantity coverage | What state coverage does the surface need? | Provide enough fake records to render: empty / one / a handful / a long list — match the surface that consumes them |
| Cross-entity invariant | Do entities reference each other? | Foreign-key style invariants MUST hold (an order's user reference resolves to an actual user record) |
| Temporal plausibility | Are timestamps and durations human-believable? | Bound dates to a recent window, durations to plausible ranges; do NOT emit zero-epoch values |
| Request-responsiveness | Does the operation take inputs that select or shape which records it returns (filter, search, sort, pagination)? | The returned set is a FUNCTION of those inputs applied to the seeded dataset — a filter narrows it, a search matches within it, a sort orders it, a page bounds it. Returning the whole dataset regardless of the inputs makes every such control on the consuming surface inert |

### Constraints

- Do NOT emit filler placeholder strings or generic test labels
- Do NOT introduce a new faker / stub library when the project's manifest
  already declares one — reuse the existing pathway
- Do NOT randomize per render — that breaks reproducibility for any
  end-to-end demo built on the virtualized adapter
- A fake value MUST satisfy the CONSUMER's own validation, not just look
  domain-plausible: a value the consumer parses, formats, matches against an
  allowed set, or range-checks MUST pass that check — a date the consumer's
  formatter accepts, a value within the set the consumer switches on, a number
  inside the consumer's valid range, an id whose shape the consumer's lookup or
  route accepts. Domain-plausible but consumer-invalid still renders as broken.
- A virtualized READ operation MUST apply the request's selecting / shaping
  inputs (filter, search, sort, pagination parameters) to the seeded dataset
  before responding — the production endpoint filters, so the virtualized one
  filters. Pattern-matching the path while discarding the query inputs returns a
  static dump that makes every filter, search, and sort control on the consuming
  surface inert. Observable: changing a selecting input changes the returned set
  (a narrower filter yields fewer records; a search term yields only matches; a
  different sort reorders; a page returns that slice).
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

### Navigable-Target Routing

A field whose value the consuming surface **navigates to, redirects to, or
otherwise dereferences as a URL / route** (an authorization or sign-in URL, a
redirect / callback URI, a `next` / `return` location, an action endpoint a
control posts to) is a **navigable target**, NOT a display field — even when its
type is a plain string. It is OUT of this partial's scope and obeys
`service-virtualization-contract`'s navigable-target rule: the value MUST resolve
INSIDE the closed system (a route the running app itself serves), never mirror an
external host.

⚠️ **Blind spot — domain plausibility is the trap here.** Applying this partial's
"domain-plausible" mandate to a navigable-target field produces a realistic-LOOKING
external URL on the project's own domain — which is exactly the wrong value,
because the running app does not serve that host and the navigation dead-ends. A
navigable target's correctness is *reachability*, not *plausibility*. Route such a
field through the contract rule; do NOT seed it as fake "data".

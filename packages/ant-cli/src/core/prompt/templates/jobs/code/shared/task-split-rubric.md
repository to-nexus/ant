## Independent Unit Splitting

Splitting work into independent units has real overhead (separate contexts, coordination, risk of pattern drift across siblings) and real benefit (failure isolation, scope-boundary preservation, focus). Whether to split is a judgement grounded in the work itself, not in counts.

### Independent unit — definition

An independent unit is a self-contained deliverable that:
1. Produces its own scope of output with no required co-modification of another unit's outputs,
2. Shares with peers at most one integration point,
3. Carries a coherent cognitive mode — one primary kind of reasoning, not a mix forcing context-switching at the implementer.

Sub-fragments of a unit are NOT independent units.

### Split when

Split when the work shows two or more independent units in the sense above AND at least one of:
- **Failure isolation matters** — one unit failing must not block the others; partial success carries value.
- **Scope boundary matters** — work materially outside the stated scope was surfaced; absorbing it would erode the deliverable boundary.
- **Cognitive mode separation matters** — bundling would force the implementer to hold incompatible reasoning modes at once.

### Do not split when the reason reduces to

- "many files",
- "files in different places/packages/domains",
- "the work feels large",
- the change *pattern* is uniform across locations even if the *locations* are scattered.

A coherent unit that touches many files belongs in one task/batch — splitting it risks pattern drift across siblings.

### Articulation

When you split, name the concrete benefit for this specific work. Generic phrasing means you are splitting where you should bundle.

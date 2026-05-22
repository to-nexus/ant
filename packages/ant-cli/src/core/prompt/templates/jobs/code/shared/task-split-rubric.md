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
- **Authorship density matters** — a unit with one consistent cognitive mode may still demand multiple separate *investigations* to author. The natural batch boundary is the *investigation boundary*: one read of the relevant existing state, one coordinated set of decisions, one verifiable diff. Split across investigation boundaries; bundle within one investigation. File count alone is not the signal — it is whether the edits inside a candidate batch share their investigation (the same reads + the same decision context informing multiple edits) or each demands its own.

Calibration (Authorship density):
- Uniform mechanical change across many files (one investigation of the pattern, N mechanical applications) = one investigation. One batch, no split regardless of file count. **Disqualifier — this case requires NO per-location state to read before applying the change**: locations must accept the same edit blindly. If each location has distinct existing markup, signatures, or styling the author must inspect to apply the change correctly, the work is NOT this case — surface uniformity of the *recipe* is necessary but not sufficient.
- "Rewrite each X for new Y" where X has its own existing state to inspect and own integration to plan = one investigation per X. Split into one batch per X. **Self-check**: if applying the same recipe to each location requires inspecting that location's existing state first, each location is its own investigation — this case, not the mechanical case above.
- "Edit N unrelated files for N unrelated reasons" — N investigations that share nothing; the existing 3 axes (coherence) likely flag this as not-a-unit before this axis fires.

**Grain — neither finer than one investigation nor coarser than one.** Over-splitting (one batch per file when files share an investigation) burns plan-tool-loop priming on the same reads repeatedly and produces no coordination value — forbidden. Over-bundling (multiple investigations in one batch) forces the executor to re-investigate midway — split it. The right grain is one investigation per batch, no finer and no coarser.

### Negative signals — never decisive alone

The signals below cannot, on their own, conclude the splitting decision. Evaluate the "Split when" AND-OR criteria above first. A negative signal only rejects a split whose justification reduces ENTIRELY to it:

- "many files" *alone* — informational. The decision turns on investigation boundaries (Authorship density above): many files under one investigation footprint (one read of shared context, one coordinated decision, one diff boundary) bundle into one batch regardless of count; many files spanning multiple investigation footprints split into one batch per footprint. File count alone is neither necessary nor sufficient.
- "files in different places/packages/domains",
- "the work feels large",
- the change *recipe* is uniform across locations — recipe uniformity does not by itself imply the mechanical case above; it must still pass the per-location-state disqualifier.

A coherent unit that touches many files bundles into one task/batch ONLY when no "Split when" criterion holds. Pattern-drift risk applies to splits chosen against the criteria, not to splits the criteria mandate.

### Articulation

When you split, name the concrete benefit for this specific work. Generic phrasing means you are splitting where you should bundle.

When the split is justified by Authorship density, articulate each batch's investigation footprint: name the shared reads, the shared decision context, and the diff boundary (e.g., "each batch = one component family — one read of the family's existing tokens, one mapping decision, one verifiable diff inside the family"). Two articulation failures rule out the split:

- If you cannot name the SHARED investigation inside a batch (each edit needs its own read), the batch is too coarse — split further.
- If you cannot name what makes batches DIFFERENT investigations (their reads and decisions overlap), the batches collapse into one — merge.

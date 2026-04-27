### Design hand-off mapping (what each section commits to which design axis)

The PRD/GDD does not stop at "what" — it also commits **where each section lands in downstream design**. The mapping is published as a table below so the planner explicitly reasons about hand-off boundaries while authoring each section.

**Why**:

- Without an explicit hand-off table, design jobs re-derive scope from prose and frequently duplicate content the PRD/GDD already commits to (e.g. system design re-listing screens, ui design re-listing entities). Duplication is an MECE violation that propagates downstream.
- With the table, each PRD/GDD section can be cited from the matching design task as `PRD §X / SC-Y → this design only elaborates the policy enforcement boundary`. The boundary is observable, not inferred.

**Usage rules**:

- The table below is **authoritative**: every domain-overlay section MUST appear in exactly one row. A section without a hand-off row is a planning omission.
- Mark cells `(indirect)` when the design axis only secondarily depends on the section, `(rare)` when the dependency is exceptional but legal, and leave it blank when the axis genuinely does not consume the section.
- A "Content/UX Level" row in the design `Abstraction Level` table on the system-design side mirrors this hand-off — together they enforce the rule **PRD/GDD owns content; design owns architecture and tokens**.
- Refine-mode: if the directive changes a section, surface every hand-off row impacted by that change so downstream design can selectively invalidate.

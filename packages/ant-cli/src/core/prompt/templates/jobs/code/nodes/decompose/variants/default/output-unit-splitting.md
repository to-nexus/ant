## Independent Output Unit Splitting

**WHY this matters**: The Task Scope Constraint above splits by persistence boundary. When the Development Source implies zero persistence boundaries, that axis is silent and task count collapses to one — wasting parallelism and forcing a single task to absorb N unrelated concerns.

**Principle**: When persistence-boundary count is 0, the unit of decomposition is an INDEPENDENT OUTPUT UNIT — a self-contained deliverable that produces its own source file and shares, with its peers, at most one integration point.

**Applicability**: This rubric governs splitting ONLY when the observation below holds. When persistence-boundary count is ≥ 1, the Task Scope Constraint above governs and this section is silent.

### Category identification

**Principle**: The category is chosen by OBSERVATION of the Development Source, not by the tech stack label. A unit category maps to a pattern of deliverables, not to a framework or language.

| Category | Observable pattern |
|---|---|
| **visual unit** | A section, route, screen, modal, or page that renders independently and lives in its own source file |
| **command** | A subcommand or action with its own entry-point surface |
| **worker** | A single-purpose event handler bound to one trigger (webhook, cron, queue consumer) |
| **exported symbol cluster** | A public API group with a distinct responsibility inside a library or module |
| **pipeline stage** | One transform or stage in a linear data flow with a defined input and output shape |

**Constraint**: Pick exactly ONE category per Development Source. Do NOT mix categories within a single unit count — if two categories apply, choose the one the directive enumerates explicitly.

### Split rule

**Observation target**: Count independent output units implied by the Development Source under the chosen category.

| Checkpoint | What to observe |
|---|---|
| **Unit count** | Does the Development Source enumerate 2+ output units in the chosen category? |
| **File independence** | Does each unit produce its own source file with no cross-unit source-file overlap? |
| **Shared integration point** | Do the units share at most ONE integration point (mount page, root command, barrel export, pipeline driver)? |

**Constraint**: When ALL three checkpoints above are yes, emit ONE `feature` task per output unit. All per-unit tasks share the SAME `parallelGroup`; none is `exclusive`.

**Constraint**: Do NOT split below the unit level. A fragment of a unit (a sub-section inside a section, a flag of a command, one method of an exported class) is NOT an independent output unit.

### Wiring rule

**Observation target**: Does the split above produce 2+ per-unit feature tasks AND do those units share an integration point?

**Constraint**: When both are yes, emit exactly ONE wiring task: `type: "feature"`, priority 600, owning the integration point file. Per-unit feature tasks MUST NOT create or modify the integration point file.

**Constraint**: When only one unit exists, OR units do not share an integration point, DO NOT emit a wiring task.

### Description shape

**Constraint**: Each per-unit feature description names ONE output unit and its delivered scope. Do NOT enumerate multiple units in a single description.

### Blind spots

⚠️ **Blind spot**: The merge exception in Task Scope Constraint ("same output files → merge") is persistence-boundary-scoped. Per-unit output files from this rubric do NOT overlap — only the integration point overlaps, and the wiring task owns it. Do NOT invoke that merge exception against per-unit output files.

⚠️ **Blind spot**: Absence of a persistence boundary is NOT a signal that "this is a single task". Count output units first, then decide.

⚠️ **Blind spot**: The category is chosen by observation of the Development Source, not by the tech stack label. A backend CLI with subcommands and a frontend SPA with sections both instantiate this rubric — one via `command`, the other via `visual unit`. The rubric is stack-agnostic.

⚠️ **Blind spot**: Sub-units of a larger unit (nav items within a section, flags within a command, methods within an exported class) share the parent unit's source file. They fail the "file independence" checkpoint and MUST stay merged.

---


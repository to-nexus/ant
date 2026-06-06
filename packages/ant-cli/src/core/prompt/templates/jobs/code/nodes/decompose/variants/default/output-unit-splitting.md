## Independent Output Unit Splitting

**WHY this matters**: The Task Scope Constraint above splits by persistence boundary. When the Development Source implies zero persistence boundaries, that axis is silent and task count collapses to one — wasting parallelism and forcing a single task to absorb N unrelated concerns. When persistence-boundary count is 0, the unit of decomposition is an INDEPENDENT OUTPUT UNIT.

**Applicability**: This rubric governs splitting ONLY when persistence-boundary count is 0. When persistence-boundary count is ≥ 1, the Task Scope Constraint above governs and this section is silent.

You receive the Development Source (ref artifacts or directive). Apply the splitting principle below to identify task-level units.

{{> jobs/code/shared/task-split-rubric }}

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

### Per-unit task emission

When the splitting principle above indicates separation, emit ONE `feature` task per identified output unit. Each per-unit task uses a DISTINCT `parallelGroup` **UNLESS two units co-locate outputs under a shared structural namespace** (the same parameterized path segment, or a parent structure one unit establishes and the other populates) — those share a `parallelGroup` (serialized; the establishing unit takes the earlier priority) per the Parallel Execution "shared structural namespace" rule. Distinct output files alone do NOT guarantee independence: a shared dynamic path segment collides even when the files differ. None is `exclusive`. See Parallel Execution rules for the group-vs-file correspondence.

**Constraint**: When the Development Source surfaces multiple independent integration points (different app/package entry roots, separate route registries), partition by integration point and evaluate each cluster separately.

### Wiring rule

**Observation target**: Does the split above produce 2+ per-unit feature tasks AND do those units share an integration point?

**Constraint**: When both are yes, emit exactly ONE wiring task per shared integration point: `type: "feature"`, priority 600, owning that integration point file. Per-unit feature tasks MUST NOT create or modify the integration point file.

**Constraint**: If split units map to multiple independent integration points (for example, different app/package entry roots or route registries), emit one wiring task per integration point. Do NOT collapse unrelated integration points into a single wiring task.

**Constraint**: When only one unit exists, OR units do not share an integration point, DO NOT emit a wiring task.

### UI pairing rule

**Observation target**: For each feature task emitted by this rubric or by Task Scope Constraint, is its output RENDERABLE — i.e. a file that renders user-visible UI?

**Principle — renderable categories**: Only the `visual unit` category produces renderable output. The other categories (`command`, `worker`, `exported symbol cluster`, `pipeline stage`) are non-renderable. Among feature tasks that do NOT fall under those five categories, wiring tasks (priority 600–649, composition-only), shared foundation tasks (priority 200–299, types / schema / utilities), data-fetching / state-management tasks, and server-side handler tasks are also non-renderable.

**Principle — pairing**: UI work mirrors the renderable subset of feature splitting. For each RENDERABLE feature task, emit exactly one per-unit ui task that pairs with it. For each NON-RENDERABLE feature task, emit NO ui task.

**Constraint — count**: The ui task count equals the renderable feature task count. If zero renderable features exist (backend-only, CLI-only, library-only project), emit ZERO ui tasks — do NOT create a ceremonial ui task.

**Constraint — pairing via parallelGroup**: Each per-unit ui task shares its `parallelGroup` with its paired renderable feature task. Same `parallelGroup` serializes them on the same output file (feature emits the skeleton first; ui restyles it second).

**Constraint — priority**: Per-unit ui tasks use priority in the 650–699 range. Distinguishability between ui tasks comes from `parallelGroup` (which matches the paired feature), not from priority.

**Constraint — globals exclusion**: Per-unit ui tasks MUST NOT touch global style layer files (project-wide CSS, theme config, token infrastructure). Those files are owned by the `design-system` task at priority 200. If global styling gaps are observed, extend the `design-system` task rather than absorbing them into a ui task.

⚠️ **Blind spot**: The singular phrasing "A corresponding ui task" in UI Task Descriptions describes a per-renderable-feature pairing, NOT a per-project singleton. Reading it as "one ui task per project" collapses N renderable units into one ui task and erases the parallelism the feature split gained.

⚠️ **Blind spot**: "Always created" in Task Type Rules means "one ui task per renderable feature when renderable features exist" — NOT "a ui task must exist in every project". Backend-only / CLI-only / library-only projects have zero renderable features and therefore ZERO ui tasks.

⚠️ **Blind spot**: Wiring tasks compose (import + mount) but do not style. They are NON-renderable in the ui-pairing sense even though their output file is a page/route component. Page-level visual styling (smooth-scroll, section landmarks, global transitions) is the `design-system` task's concern, not a ui task's.

⚠️ **Blind spot**: A ui task paired with its feature task via the same `parallelGroup` is the natural placement. Putting the ui task in a separate `parallelGroup` (e.g. `"ui-main"`) lets it run concurrently with the feature task, causing a file-write race on the skeleton file.

### Description shape

**Constraint**: Each per-unit feature description MUST name a single output unit and its delivered scope. Do NOT enumerate multiple units in a single description.

### Blind spots

⚠️ **Blind spot**: The merge exception in Task Scope Constraint ("same output files → merge") is persistence-boundary-scoped. Per-unit output files from this rubric do NOT overlap — only the integration point overlaps, and the wiring task owns it. Do NOT invoke that merge exception against per-unit output files.

⚠️ **Blind spot**: Absence of a persistence boundary is NOT a signal that "this is a single task". Count output units first, then decide.

⚠️ **Blind spot**: Multi-app or multi-package projects often have multiple entry roots. "Exactly one wiring task" applies per integration point, NOT globally across the whole project.

⚠️ **Blind spot**: The category is chosen by observation of the Development Source, not by the tech stack label. A backend CLI with subcommands and a frontend SPA with sections both instantiate this rubric — one via `command`, the other via `visual unit`. The rubric is stack-agnostic.

⚠️ **Blind spot**: Sub-units of a larger unit (nav items within a section, flags within a command, methods within an exported class) share the parent unit's source file. They fail the "file independence" checkpoint and MUST stay merged.

---


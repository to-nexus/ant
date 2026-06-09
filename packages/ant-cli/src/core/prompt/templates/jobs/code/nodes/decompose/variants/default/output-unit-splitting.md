## Independent Output Unit Splitting

**WHY this matters**: The Task Scope Constraint above splits by persistence boundary. When the Development Source implies zero persistence boundaries, that axis is silent and task count collapses to one — wasting parallelism and forcing a single task to absorb N unrelated concerns. When persistence-boundary count is 0, the unit of decomposition is an INDEPENDENT OUTPUT UNIT.

**Applicability**: This rubric governs splitting ONLY when persistence-boundary count is 0. When persistence-boundary count is ≥ 1, the Task Scope Constraint above governs and this section is silent.

You receive the Development Source (ref artifacts or directive). Apply the splitting principle below to identify task-level units.

{{> jobs/code/shared/task-split-rubric }}

### Category identification

**Principle**: The category is chosen by OBSERVATION of the Development Source, not by the tech stack label. A unit category maps to a pattern of deliverables, not to a framework or language.

| Category | Observable pattern |
|---|---|
| **visual unit** | A unit whose output renders a user-visible visual surface and lives in its own source file — an independent section / route / screen / modal / page, OR a shared frame / navigation chrome that wraps them |
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

**Constraint — shared decisions beyond the integration-point file**: A host-entry file is only ONE shape of shared decision. A shared decision that is not a single file — an addressing / navigation scheme, an access contract, a cross-unit vocabulary (see *Shared Decisions* in the rules) — is likewise owned by ONE producer task (at the band its dependency position implies) and consumed by the per-unit tasks. Do NOT let each per-unit task decide it locally; route it to a producer the same way a host entry routes to a wiring task.

### UI pairing rule

**Observation target**: For each feature task emitted by this rubric or by Task Scope Constraint, is its output RENDERABLE — i.e. a file that renders user-visible UI?

**Principle — renderable is decided by output NATURE, not task category**: A task is renderable iff its output produces a **user-visible visual surface**. The `visual unit` category always qualifies. Critically, a host-entry / integration task ALSO qualifies for the portion that renders **navigation chrome** (a frame the user sees — global nav, sidebar, local nav) — composition is not its only output when it also paints a visible frame. Only outputs with **no visual surface** are non-renderable: pure composition wiring (provider / route mount that renders no chrome), shared foundation (priority 200–299, types / schema / utilities), data-fetching / state-management, server-side handlers, and the `command` / `worker` / `exported symbol cluster` / `pipeline stage` categories.

**Principle — pairing**: UI work mirrors the renderable subset of feature splitting. For each RENDERABLE feature task, emit exactly one per-unit ui task that pairs with it. For each NON-RENDERABLE feature task, emit NO ui task.

**Constraint — count**: The ui task count equals the renderable feature task count. If zero renderable features exist (backend-only, CLI-only, library-only project), emit ZERO ui tasks — do NOT create a ceremonial ui task.

**Constraint — pairing via parallelGroup**: Each per-unit ui task shares its `parallelGroup` with its paired renderable feature task. Same `parallelGroup` serializes them on the same output file: the feature task emits a functionally complete but visually unstyled component first (all interactive behavior present and working — "unstyled" means missing visual polish, NOT a non-functional stub); the ui task then enhances it second.

**Constraint — priority**: Per-unit ui tasks use priority in the 650–699 range. Distinguishability between ui tasks comes from `parallelGroup` (which matches the paired feature), not from priority.

**Constraint — do not redefine the shared style foundation**: The `design-system` task (priority 200) owns the token / style FOUNDATION (project-wide tokens, theme config). A per-unit ui task MUST NOT fork or redefine that foundation. It MAY, when an enhancement genuinely requires it, extend shared or global style layers and touch sibling / other-package presentation for integration — building ON the foundation, not redeclaring it. If a token-level gap is observed, extend the `design-system` task rather than redefining tokens locally.

⚠️ **Blind spot**: The singular phrasing "A corresponding ui task" in UI Task Descriptions describes a per-renderable-feature pairing, NOT a per-project singleton. Reading it as "one ui task per project" collapses N renderable units into one ui task and erases the parallelism the feature split gained.

⚠️ **Blind spot**: "Always created" in Task Type Rules means "one ui task per renderable feature when renderable features exist" — NOT "a ui task must exist in every project". Backend-only / CLI-only / library-only projects have zero renderable features and therefore ZERO ui tasks.

⚠️ **Blind spot**: A host-entry task that ONLY composes (provider / route mount, renders no chrome) is non-renderable. But when a host-entry renders navigation chrome the user sees (a global nav / sidebar / local nav — including a per-section bar with title / back / search / notification), that chrome IS a visual surface → the task is renderable and earns a paired ui task like any screen. Do NOT let navigation chrome fall through as "just wiring" — that is exactly how a designed frame ends up unstyled or omitted. Only truly global page-level concerns with no owning surface (smooth-scroll, global transitions) remain the `design-system` task's concern.

⚠️ **Blind spot**: A ui task paired with its feature task via the same `parallelGroup` is the natural placement. Putting the ui task in a separate `parallelGroup` (e.g. `"ui-main"`) lets it run concurrently with the feature task, causing a file-write race on the shared component file.

### Description shape

**Constraint**: Each per-unit feature description MUST name a single output unit and its delivered scope. Do NOT enumerate multiple units in a single description.

### Blind spots

⚠️ **Blind spot**: The merge exception in Task Scope Constraint ("same output files → merge") is persistence-boundary-scoped. Per-unit output files from this rubric do NOT overlap — only the integration point overlaps, and the wiring task owns it. Do NOT invoke that merge exception against per-unit output files.

⚠️ **Blind spot**: Absence of a persistence boundary is NOT a signal that "this is a single task". Count output units first, then decide.

⚠️ **Blind spot**: Multi-app or multi-package projects often have multiple entry roots. "Exactly one wiring task" applies per integration point, NOT globally across the whole project.

⚠️ **Blind spot**: The category is chosen by observation of the Development Source, not by the tech stack label. A backend CLI with subcommands and a frontend SPA with sections both instantiate this rubric — one via `command`, the other via `visual unit`. The rubric is stack-agnostic.

⚠️ **Blind spot**: Sub-units of a larger unit (nav items within a section, flags within a command, methods within an exported class) share the parent unit's source file. They fail the "file independence" checkpoint and MUST stay merged.

---


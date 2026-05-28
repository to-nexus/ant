## Single-session capacity (plan-time only)

A `batches[]` entry that you do NOT fan out further runs as one execute cycle — one task with a bounded recursion budget. A task whose **involvement scope** is too large for one cycle exhausts the budget before completion, and recursion-limit termination is unrecoverable. Such tasks must be split at plan time — *regardless* of the prevailing budget value. The principle is intrinsic to the task's shape, not arithmetic against a number.

### Orthogonality

This axis is orthogonal to the separability rubric above. The rubric decides whether the work *can* be split. This axis decides whether the task's involvement scope *is too large* for one cycle. When this axis fires, split — even when the separability rubric supports bundling. When that happens, `parentReasoning` names single-session capacity (not coherence) as the concrete benefit.

The rubric's negative signal "many files alone — informational" applies to *separability* (count alone does not make work conceptually independent). It does **not** override this axis: a task's involvement scope still adds to capacity bulk even when its parts share one investigation conceptually.

### The task's involvement scope

The unit of measurement is the **task as a whole**, not any individual file. A task's involvement scope is the union of every file the task will *read*, *modify*, *create*, *delete*, or *discover* before it can emit `<done>`. Three dimensions describe this scope; each can fire alone, and any two reinforce each other:

- **Modification breadth** — the set of files the task will create / modify / delete. Many files compound: each location still consumes its own cycle round to author the edit, even when the edit itself is trivial.
- **Reference depth** — the files the task must *read* per modification to inform the edit: the modified file's existing state, paired types, sibling references (design-system components, adjacent markup, related modules), upstream consumers. Each per-modification read is its own cycle round; depth compounds across the modification set.
- **Exploration breadth** — the unknown landscape the task must *discover* before any modification can begin: which design-system components exist, which modules house relevant utilities, which directory layout serves the target tech stack. Exploration cost is orthogonal to the other two — a task with a small modification breadth can still burn many rounds listing directories to find the right files.

A task's involvement scope is too large for one cycle when ANY single dimension is large *or* two dimensions are even moderately large in combination. The judgement is qualitative. Do NOT estimate round counts, do NOT compare against a numeric ceiling, do NOT compute `breadth × depth + exploration`. Look at the task's overall scope, recognise which dimensions are heavy, decide.

### Articulation — fail-closed constraint

A bundle decision MUST name, in `parentReasoning`, the task's character along ALL THREE dimensions of involvement scope (modification breadth / reference depth / exploration breadth) and why none of them — and no combination of them — makes the task's scope too large for one cycle. Three articulation failures rule out the bundle:

- `parentReasoning` does not characterise one or more of the three dimensions. The planner skipped at least one capacity check. Split.
- The bundle's only reference-depth defense is "the recipe is uniform across locations" without addressing whether each modification's existing state and references must be read first. Split — and re-run Authorship density's per-location-state self-check, because uniform-recipe defenses are the failure mode this axis exists to catch.
- The bundle's exploration defense ignores how much of the codebase landscape the planner has not yet observed. If the task will require listing many directories or searching for unfamiliar symbols before any modification can be authored, exploration is large regardless of how few files the task ultimately modifies. Split.

### Blind-spot reminders

**Pattern A — Recipe uniformity hides reference depth.** A task's modifications appear to share one transformation rule, but each modification still requires its own reads of existing state (markup, paired types, sibling references) before the rule can be applied correctly. Surface uniformity of the recipe is necessary but not sufficient for the mechanical case in Authorship density above — when each modification has its own existing state to consult, the task's reference depth is real.

**Pattern B — Unknown landscape hides exploration breadth.** When the task's recipe references a library, package, or design-system whose API surface the planner has not yet observed, the implementer will burn many cycle rounds listing directories and searching for symbols before any modification is possible. A directive like "apply design-system tokens across all instructor screens" sounds reference-depth-light, but if the planner does not yet know which design-system components exist for each visual element, the discovery work is the bulk — not the edits.

**Pattern C — Modification count alone seems harmless.** A task whose modifications are individually trivial still consumes one cycle round per modification to author the edit. "These are all one-line changes" does not collapse N modifications into one cycle round.

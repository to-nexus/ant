## UI SOURCE — HANDOFF

### Principle (Lazy-read, not schema-based)

The handoff bundle under `visual/ui/handoff/` is a free-form collection of files — any mix of HTML, CSS, Markdown, JSON, and raster/vector assets. There is **no agreed schema**. You are given a **manifest of stub entries** (one per file), not file contents. Read entries on demand via `read_file`; never assume a schema across files. The bundle is read lazily — never eagerly dumped into the prompt.

### Access contract

- Every text-kind entry carries the canonical relative path. Call `read_file("<path>")` — optionally with `startLine` / `endLine` — to observe the contents when the current task requires them.
- Every binary-kind entry (png, jpg, woff, …) is a **path-only pointer**. Reference it from the emitted code (e.g. `url("visual/ui/handoff/hero.png")`) but do **NOT** invoke `read_file` on it — utf-8 decoding would produce garbage.
- Use `list_files("visual/ui/handoff")` if you suspect the manifest is incomplete or want to confirm a sibling file exists.

{{> jobs/shared/injections/handoff-code-shape-discipline }}

### Constraint (No cross-file consistency assumption)

- Do NOT assume two handoff files follow the same conventions (naming, structure, units).
- Do NOT conflate partial definitions across files unless a file you actually read states the relation.
- Do NOT treat filename or extension patterns as semantic contracts; interpret the contents you observed via `read_file`.

### Observable-only rule

Every design value (token, colour, spacing, layout, typography, micro-interaction) used in the output MUST be traceable to a specific file you read (by path + section / line range). When a value is not observable anywhere in the bundle, fall back to VisualTier defaults or framework conventions rather than inventing values. Implementation choices (framework, imports, dependencies, file organisation) are governed by the target codebase, NOT by what the handoff happens to use.

### Blind spot reminder

Handoff content is often redundant across files (e.g. the same colour appears in HTML, CSS, and an accompanying spec). Pick the most explicit representation per property after reading the relevant files; do not merge conflicting definitions silently. Reading ONE authoritative file is preferable to scanning all files. See the code-shape discipline above for handling code-shaped entries.

## UI SOURCE — HANDOFF

### Principle (Lazy-read, not schema-based)

The handoff bundle under `visual/ui/handoff/` is a free-form collection of files — any mix of HTML, CSS, Markdown, JSON, and raster/vector assets. There is **no agreed schema**. You are given a **manifest of stub entries** (one per file), not file contents. Read entries on demand via `read_file`; never assume a schema across files. The bundle is read lazily — never eagerly dumped into the prompt.

### Access contract

- Every text-kind entry carries the canonical relative path. Call `read_file("<path>")` — optionally with `startLine` / `endLine` — to observe the contents when the current task requires them.
- Every binary-kind entry (png, jpg, woff, …) is a **path-only pointer**. Reference it from the emitted code (e.g. `url("visual/ui/handoff/hero.png")`) but do **NOT** invoke `read_file` on it — utf-8 decoding would produce garbage.
- Use `list_files("visual/ui/handoff")` if you suspect the manifest is incomplete or want to confirm a sibling file exists.

### Discipline (Survey-first, guide-then-execute)

Free-form handoffs commonly carry a user-authored guide that states the entry point, the rendering intent, exclusions, and ordering. Surface that guide BEFORE diving into code-shaped files.

1. **Survey the manifest**. Scan every stub entry. Note (a) directory shape (grouped by screen / by component / flat), (b) relative file sizes, (c) which entries are token-shaped vs. code-shaped vs. binary.
2. **Identify guide candidates**. Look for one or more files whose path, name, or position suggests the user wrote them AS a guide for this bundle:
   - Markdown files at the handoff root or at the top of a sub-bundle.
   - Names whose stem contains (case-insensitive, partial) any of: `handoff`, `readme`, `index`, `guide`, `instructions`, `intent`, `notes`, `spec`, `overview`, `manifest`. The list is illustrative — a markdown file whose name otherwise suggests "I am explaining this bundle" also counts.
   - A markdown file that is significantly smaller than the surrounding code-shaped entries (the writer summarising for the reader).
   When multiple candidates exist, read the smallest plausible one first. When none is obvious, read the most prominently-named markdown entry before any code-shaped file.
3. **Follow the guide**. Whatever the guide states about entry points, reading order, scope, exclusions, or visual intent IS the user's authoritative direction for this task. Subordinate later reads to it: if the guide says "Read X in full", read X next; if it says "ignore Y", do not read Y.
4. **Execute**. With the guide in mind, plan and perform on-demand `read_file` calls in the order the guide dictates. If no guide is present after the survey, fall back to dependency order: token declarations and spec documents (json or markdown, whichever the bundle uses) → markup → styles → scripts.

### Blind spot reminder (Survey)

⚠️ Skipping the survey and reading a large `.html` / `.jsx` file first is the dominant failure mode — context fills with implementation details and the user's stated direction never surfaces. Always survey + guide first, even if it costs one extra read.

{{> jobs/shared/injections/handoff-code-shape-discipline }}

### Constraint (No cross-file consistency assumption)

- Do NOT assume two handoff files follow the same conventions (naming, structure, units).
- Do NOT conflate partial definitions across files unless a file you actually read states the relation.
- Do NOT treat filename or extension patterns as semantic contracts; interpret the contents you observed via `read_file`.

### Observable-only rule

Every design value (token, colour, spacing, layout, typography, micro-interaction) used in the output MUST be traceable to a specific file you read (by path + section / line range). When a value is not observable anywhere in the bundle, fall back to VisualTier defaults or framework conventions rather than inventing values. Implementation choices (framework, imports, dependencies, file organisation) are governed by the target codebase, NOT by what the handoff happens to use.

### Blind spot reminder (Redundancy)

Handoff content is often redundant across files (e.g. the same colour appears in HTML, CSS, and an accompanying spec). Pick the most explicit representation per property after reading the relevant files; do not merge conflicting definitions silently. Reading ONE authoritative file is preferable to scanning all files. See the code-shape discipline above for handling code-shaped entries.

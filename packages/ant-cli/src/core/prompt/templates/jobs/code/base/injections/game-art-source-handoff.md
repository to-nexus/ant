## GAME-ART SOURCE — HANDOFF

### Principle (Lazy-read, not schema-based)

The handoff bundle under `visual/game-art/handoff/` is a free-form collection of files — any mix of sprite sheets, audio, tilemaps, atlas JSON, Markdown notes, and reference images. There is **no agreed schema** and no `game-art-*.json` catalog to lean on. You are given a **manifest of stub entries** (one per file), not file contents. Read entries on demand via `read_file`; never assume a schema across files. The bundle is read lazily — never eagerly dumped into the prompt.

### Access contract

- Every text-kind entry carries the canonical relative path. Call `read_file("<path>")` — optionally with `startLine` / `endLine` — to observe the contents when the current task requires them.
- Every binary-kind entry (png, mp3, ogg, woff, atlas image, …) is a **path-only pointer**. Do **NOT** invoke `read_file` on it — utf-8 decoding would produce garbage.
- Use `list_files("visual/game-art/handoff")` if you suspect the manifest is incomplete or want to confirm a sibling file exists.

### Reachability (handoff asset → engine loader)

A handoff asset under `visual/game-art/handoff/` is the source-of-truth location — it is NOT a directly-fetchable URL. To make it playable, the same path convention as `kind:external` catalog assets applies:

- Make each referenced binary web-servable per the framework's static-asset convention (the code job's asset-placement guidance commits the concrete destination for the active framework).
- Register it in the engine loader under a **stable key you choose** (e.g. a kebab-case id derived from the file stem) and reference that key from gameplay code. There is no catalog `id` here, so the key is yours to define — keep it stable within the build.
- Text-kind data (tilemap / atlas JSON) loads via the engine's JSON/atlas loader from the same servable URL.

### Discipline (Survey-first, guide-then-execute)

Free-form handoffs commonly carry a user-authored guide that states the entry point, the intent, exclusions, and ordering. Surface that guide BEFORE diving into code- or asset-shaped files.

1. **Survey the manifest**. Scan every stub entry. Note (a) directory shape (grouped by sprite / by scene / flat), (b) relative file sizes, (c) which entries are text-shaped vs. asset-shaped vs. audio.
2. **Identify guide candidates**. Look for files whose path, name, or position suggests the user wrote them AS a guide: Markdown at the handoff root; names whose stem contains (case-insensitive, partial) any of `handoff`, `readme`, `index`, `guide`, `instructions`, `intent`, `notes`, `spec`, `overview`, `manifest`, `design`; or a markdown file significantly smaller than the surrounding asset entries. Read the smallest plausible one first; when none is obvious, read the most prominently-named markdown entry before any large asset.
3. **Follow the guide**. Whatever the guide states about entry points, reading order, scope, exclusions, or visual/audio intent IS the user's authoritative direction for this task.
   - **Generated-bundle fast path**: a root `DESIGN.md` whose final section is an **Artifacts** manifest marks a producer-generated bundle following the shared handoff package format (DESIGN.md root → `tokens/` custom properties → `components/`·`entities/` → `screens/`, `styles.css` as the import-only entry). Trust the manifest as the authoritative index and reading order; the lazy-read discipline still governs how much you read.
4. **Execute**. Plan on-demand `read_file` calls in the order the guide dictates. If no guide is present after the survey, fall back to: notes / spec (text) → tilemap / atlas manifests → then wire sprite / audio assets by making them servable and registering loader keys.

### Blind spot reminder (Survey)

⚠️ Skipping the survey and reading a large data file first is the dominant failure mode — context fills with details and the user's stated direction never surfaces. Always survey + guide first, even if it costs one extra read.

{{> jobs/shared/injections/handoff-code-shape-discipline }}

### Constraint (No cross-file consistency assumption)

- Do NOT assume two handoff files follow the same conventions (naming, atlas frame layout, audio format, units).
- Do NOT conflate definitions across files unless a file you actually read states the relation.
- Do NOT treat filename or extension patterns as semantic contracts; interpret the contents you observed via `read_file`.

### Observable-only rule

Every value used in the output (sprite key, frame, audio clip, palette, timing) MUST be traceable to a specific file you read (by path + section / line range) or to the game's `game-art-tokens.json` when one is also present. When a value is not observable in the bundle, fall back to `gameArtTier.concept` / `perspective` derived defaults and framework conventions rather than inventing values. Implementation choices (engine API, imports, file organisation) are governed by the target codebase, NOT by what the handoff happens to use.

### Cross-pool boundary (I6)

- ❌ A handoff asset MUST NOT be referenced from a service-pool path. Game handoff assets live only under `visual/game-art/handoff/` (source) and their servable destination in the game workspace.
- The single-source guarantee (in-canvas + HUD share one art direction) still holds — reconcile handoff-observed values with `game-art-tokens.json` when both are present; a token doc, when read, is the more explicit representation.

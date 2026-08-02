# Game-Art Handoff Bundle Task Decomposition

You are decomposing game-art design work into file-authoring tasks for a **handoff bundle** — a structured design package under `visual/game-art/handoff/`.

**Source mode**: Description-driven — the directive plus PRD / source documents drive the design; there is no external visual source.

**Job Mode**: {{detectedMode}}

---

## 📥 INPUT CONTEXT

### Requirements ({{documentName}})

{{> jobs/design/nodes/decompose/shared/input-context}}

---

{{#if (eq detectedMode "refactor")}}
{{> jobs/shared/injections/handoff-bundle-revision}}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## 🔧 REVISE MODE — Modify the Existing Bundle In Place
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**Principle**: Create the MINIMUM set of tasks that realizes the requested change — usually one task per affected file.

- The existing bundle files appear above as a **manifest** (path + size per entry), not as inline content. Call `read_file(path)` on the entries the request touches — using the FULL manifest path as shown — to observe their content before deciding which files change.
- **`targetFile` is a manifest path from above with the `visual/game-art/handoff/` prefix stripped — bundle-relative** (e.g. manifest `visual/game-art/handoff/project/tokens/palette.css` → targetFile `project/tokens/palette.css`). Do NOT re-derive a canonical bundle layout; do NOT invent parallel directories beside the existing structure. Observe where the bundle keeps each concern and edit it there.
- Create exactly one task per affected file; do NOT create tasks for files the request does not touch.
- ⚠️ Do NOT create guide / entry-stylesheet / token-file tasks unless the request changes those files' content.
- A task may introduce a file the bundle does not have ONLY when the request genuinely adds one: set `"newFile": true` on that task and place the file inside a directory the bundle already has (or at the bundle root). When a file is added, also emit (or extend) the task updating the bundle's ENTRY DOC (see above) to register it.
- When the change merges or removes files, the task that owns the SURVIVING file carries `"removeFiles": ["<bundle-relative path>", ...]` — manifest paths with the prefix stripped, exactly like `targetFile`. Do NOT emit delete-only tasks; do NOT list a removed path in `<targetFiles>`. When a removed path is referenced by the entry doc, also emit (or extend) the entry-doc task to drop the reference.
- A value change that lives in the bundle's token layer (whichever file the manifest shows owns it) is fixed there — never patched locally in a screen or entity demo.
- When a change alters what a file IS (purpose, not content detail), also emit a task updating the bundle's ENTRY DOC.

{{else}}
{{> jobs/shared/injections/handoff-package-format}}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## 🆕 GENERATE MODE — Author a New Bundle
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**Derive the file set from the PRD** (aesthetic, entities, scenes, HUD) using the directory family above — instantiate only what this game needs.

- **Entities** (`entities/`): engine-rendered visual units — playable characters, enemies, props, particles, projectile looks — grouped by family (one pair per coherent group), derived from the PRD's entity/mechanic sections. Per CRITICAL RULE 6 (class-ownership closure): one `.css` task at stage 2 plus its specimen `.html` task at stage 3.
- **Components** (`components/`): web-rendered game UI — menus, HUD widgets, dialogs, overlays. Derive the shared class layer per CRITICAL RULE 6 — one `.css` task at stage 2 plus its specimen `.html` task at stage 3.
- **Screens** (`screens/`): title / menu / in-game HUD state / results — one task per screen file. Cap at 8; merge minor states.
- **Tokens**: palette / silhouette / lighting / motion-tone + HUD tokens as CSS custom properties, split by concern only as far as the design warrants.
- In-canvas motion vocabulary (sprite movement feel, particle behavior, projectile arcs) belongs to entity demos and DESIGN.md — NOT to web UI interaction rules.

**Concept seed → DESIGN.md authority**: when a `gameArtTier.concept` basis block is injected above, treat it as the SEED — the starting art direction, not the final word. DESIGN.md §1 (Visual Theme & Atmosphere) and §2 (Color Palette & Roles) EXPAND and SUPERSEDE it: they carry the full, grounded direction. The flow is one-directional (seed → DESIGN.md); never restate the seed verbatim, and if the PRD and the seed conflict, the PRD-grounded DESIGN.md wins.

**Art-bible completeness** — the bundle must let a downstream implementer build every visible surface. Ensure the decomposition covers:
- **Entity art direction**: DESIGN.md states each entity family's silhouette weight, proportion, and color-role convention; the `entities/` demos realize it. Do not leave entity look to chance.
- **Camera / perspective**: DESIGN.md notes a camera treatment consistent with `gameArtTier.perspective` (2d framing & Z-order, or 3d camera & depth) so entity and scene files agree.
- **Atmosphere**: DESIGN.md §1 states the world's mood, and — when the game implies it — time-of-day / weather / lighting-mood so scenes read as one place.

### Available Resources

| Resource | Count |
|----------|-------|
| Asset files (`assets/`) | {{assetCount}} |

⚠️ **Blind spot**: real asset files already placed in the workspace are referenced by their existing path; missing imagery is authored INSIDE the bundle — never as a dangling path, never in a workspace directory outside the bundle root. Shared marks and state illustrations go to `assets/`; per-content normal-state imagery is authored by its consuming page. An empty-state illustration planned as "the" image asset will end up in every normal slot — plan imagery per state, not per "needs an image". Production-quality sprites/audio remain user placement — bundle demos stay at vector/primitive fidelity.
{{/if}}

---

{{> jobs/design/nodes/decompose/variants/game-art-design-by-handoff/rules}}
